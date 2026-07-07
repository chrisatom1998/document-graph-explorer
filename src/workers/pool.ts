/**
 * Worker pool for the parse/embed pipeline (spec §4.3): up to POOL_SIZE
 * pipeline workers, created lazily, one in-flight job per worker with the
 * backlog queued inside the pool. Queuing here (not in the workers' message
 * queues) means a job's timeout measures processing time, not time spent
 * waiting behind other jobs — and a worker failure rejects only its
 * in-flight job, never the queued backlog. The pool owns requestId
 * assignment — the requestId on the message passed to request() is
 * overwritten.
 */

import { POOL_SIZE } from '../config';
import type { PoolRequest, PoolResponse } from '../model/types';

const PARSE_REQUEST_TIMEOUT_MS = 30_000;
// Embeddings can legitimately run long (first-use WASM compile + model load,
// then batched inference), but must not hang the serialized ingest chain
// forever if the worker wedges — so cap them generously rather than not at all.
const EMBED_REQUEST_TIMEOUT_MS = 180_000;

export interface ModelProgress {
  loaded: number;
  total: number;
  note: string;
}
type ProgressListener = (progress: ModelProgress) => void;
type WorkerCrashListener = (error: Error) => void;

/** Structural Worker surface, injectable for tests (no Worker in Node). */
export interface PipelineWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<PoolResponse>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror: ((ev: MessageEvent) => void) | null;
}

function spawnPipelineWorker(): PipelineWorkerLike {
  return new Worker(new URL('./pipeline.worker.ts', import.meta.url), {
    type: 'module',
  });
}

interface PoolOptions {
  workerFactory?: () => PipelineWorkerLike;
  size?: number;
}

interface QueuedJob {
  payload: PoolRequest; // requestId already assigned
  transfer?: Transferable[];
  resolve: (response: PoolResponse) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
}

interface InFlightRequest {
  resolve: (response: PoolResponse) => void;
  reject: (error: Error) => void;
  workerIndex: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class WorkerPool {
  private workers: (PipelineWorkerLike | null)[] = [];
  private busy: number[] = [];
  private queue: QueuedJob[] = [];
  private pending = new Map<number, InFlightRequest>();
  /**
   * Embed requests that timed out on the caller side but whose worker is
   * still processing them. Maps requestId → workerIndex so a late response
   * can free the busy slot without retiring the (warm-model) worker.
   */
  private abandoned = new Map<number, number>();
  private nextRequestId = 1;
  private progressListeners = new Set<ProgressListener>();
  private crashListeners = new Set<WorkerCrashListener>();
  private disposed = false;
  private readonly workerFactory: () => PipelineWorkerLike;
  private readonly size: number;

  constructor(options: PoolOptions = {}) {
    this.workerFactory = options.workerFactory ?? spawnPipelineWorker;
    this.size = Math.max(1, options.size ?? POOL_SIZE);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private spawn(slot?: number): number {
    const index = slot ?? this.workers.length;
    const worker = this.workerFactory();
    worker.onmessage = (ev: MessageEvent<PoolResponse>) => this.handleMessage(ev.data);
    worker.onerror = (ev: ErrorEvent) =>
      this.handleWorkerFailure(index, new Error(ev.message || 'pipeline worker crashed'));
    worker.onmessageerror = () =>
      this.handleWorkerFailure(index, new Error('pipeline worker message could not be decoded'));
    this.workers[index] = worker;
    this.busy[index] = 0;
    return index;
  }

  /** Idle worker if any; else grow up to size; else -1 (job stays queued). */
  private pickIdleWorker(): number {
    for (let i = 0; i < this.workers.length; i += 1) {
      if (this.workers[i] && this.busy[i] === 0) return i;
    }
    const emptySlot = this.workers.findIndex((w) => w === null);
    if (emptySlot >= 0) return this.spawn(emptySlot);
    if (this.workers.length < this.size) return this.spawn();
    return -1;
  }

  private requestTimeoutMs(msg: PoolRequest): number {
    if (msg.type === 'parse' || msg.type === 'analyze') return PARSE_REQUEST_TIMEOUT_MS;
    if (msg.type === 'embed' || msg.type === 'embedQuery') return EMBED_REQUEST_TIMEOUT_MS;
    return 0;
  }

  request<T extends PoolResponse>(msg: PoolRequest, transfer?: Transferable[]): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('WorkerPool is disposed'));
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const payload = { ...msg, requestId } as PoolRequest;
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        payload,
        transfer,
        // runtime correlation by requestId guarantees the response matches
        // the request; the caller asserts the concrete response type T
        resolve: resolve as unknown as (response: PoolResponse) => void,
        reject,
        timeoutMs: this.requestTimeoutMs(msg),
      });
      this.pump();
    });
  }

  /** Dispatch queued jobs while an idle worker (or room to grow) exists. */
  private pump(): void {
    while (this.queue.length > 0) {
      const index = this.pickIdleWorker();
      if (index < 0) return; // every worker is mid-job; backlog waits here
      const job = this.queue.shift();
      if (!job) return;
      this.dispatch(index, job);
    }
  }

  private dispatch(index: number, job: QueuedJob): void {
    const worker = this.workers[index];
    if (!worker) {
      // slot vanished between pick and dispatch (shouldn't happen) — requeue
      this.queue.unshift(job);
      return;
    }
    const requestId = job.payload.requestId;
    const jobType = job.payload.type;
    this.busy[index] += 1;
    // The timer starts at dispatch — the moment the worker actually gets the
    // job — never at enqueue, where a long backlog would expire it unfairly.
    const timer =
      job.timeoutMs > 0
        ? setTimeout(() => {
            if (!this.pending.has(requestId)) return;
            if (jobType === 'embed' || jobType === 'embedQuery') {
              // An embed worker has an expensively-loaded model (first-use
              // WASM compile + weights) resident in memory. Retiring the
              // whole worker over one slow request would throw that away
              // and force the NEXT request to pay the load cost again —
              // so reject only this request and leave the worker (and its
              // warm model) running for whatever comes next. Contrast with
              // parse/analyze below, which have no comparable warm state to
              // protect and retiring is the simpler/safer default.
              this.rejectTimedOut(
                index,
                requestId,
                new Error(`${jobType} worker request timed out`),
              );
            } else {
              this.handleWorkerFailure(index, new Error(`${jobType} worker request timed out`));
            }
          }, job.timeoutMs)
        : undefined;
    this.pending.set(requestId, {
      resolve: job.resolve,
      reject: job.reject,
      workerIndex: index,
      timer,
    });
    try {
      if (job.transfer && job.transfer.length > 0) worker.postMessage(job.payload, job.transfer);
      else worker.postMessage(job.payload);
    } catch (err) {
      if (timer) clearTimeout(timer);
      this.pending.delete(requestId);
      this.busy[index] = Math.max(0, this.busy[index] - 1);
      job.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** 'model:progress' messages arrive with any requestId (usually -1). */
  onModelProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  onWorkerCrash(listener: WorkerCrashListener): () => void {
    this.crashListeners.add(listener);
    return () => {
      this.crashListeners.delete(listener);
    };
  }

  private handleMessage(msg: PoolResponse): void {
    if (msg.type === 'model:progress') {
      const progress: ModelProgress = { loaded: msg.loaded, total: msg.total, note: msg.note };
      for (const listener of this.progressListeners) listener(progress);
      return;
    }
    const entry = this.pending.get(msg.requestId);
    if (!entry) {
      // Late response for an embed that already timed out on the caller
      // side — free the busy slot we held open and dispatch the backlog.
      const abandonedIndex = this.abandoned.get(msg.requestId);
      if (abandonedIndex === undefined) return;
      this.abandoned.delete(msg.requestId);
      this.busy[abandonedIndex] = Math.max(0, this.busy[abandonedIndex] - 1);
      this.pump();
      return;
    }
    this.pending.delete(msg.requestId);
    if (entry.timer) clearTimeout(entry.timer);
    this.busy[entry.workerIndex] = Math.max(0, this.busy[entry.workerIndex] - 1);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
    this.pump();
  }

  /**
   * Rejects a single timed-out embed request without retiring the worker
   * that holds the loaded model. The worker is still processing the
   * abandoned job (a worker's event loop can't be interrupted mid-job), so
   * the busy slot stays held until the late response arrives — otherwise
   * the next job would be posted into the worker's message queue behind
   * the abandoned one while its timeout already ticks, unfairly failing
   * healthy follow-up work.
   */
  private rejectTimedOut(index: number, requestId: number, error: Error): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    if (entry.timer) clearTimeout(entry.timer);
    this.abandoned.set(requestId, index);
    entry.reject(error);
    // Do not free busy[index] or pump — wait for the late response.
  }

  private retireWorker(index: number): void {
    const worker = this.workers[index];
    if (worker) worker.terminate();
    this.workers[index] = null;
    this.busy[index] = 0;
    for (const [id, workerIndex] of [...this.abandoned]) {
      if (workerIndex === index) this.abandoned.delete(id);
    }
  }

  private handleWorkerFailure(index: number, error: Error): void {
    for (const listener of this.crashListeners) {
      try {
        listener(error);
      } catch (err) {
        console.warn('[knowledge-nebula] worker crash listener failed', err);
      }
    }
    // Only in-flight requests are bound to this worker; the queued backlog
    // carries on against a replacement spawned lazily by the next pump.
    for (const [id, entry] of [...this.pending]) {
      if (entry.workerIndex !== index) continue;
      this.pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.retireWorker(index);
    this.pump();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const worker of this.workers) worker?.terminate();
    const error = new Error('WorkerPool is disposed');
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.abandoned.clear();
    for (const job of this.queue) job.reject(error);
    this.queue = [];
    this.workers = [];
    this.busy = [];
    this.progressListeners.clear();
    this.crashListeners.clear();
  }
}

let singleton: WorkerPool | null = null;

export function getPool(): WorkerPool {
  if (!singleton || singleton.isDisposed) singleton = new WorkerPool();
  return singleton;
}
