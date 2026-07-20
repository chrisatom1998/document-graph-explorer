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
  private nextRequestId = 1;
  private progressListeners = new Set<ProgressListener>();
  private crashListeners = new Set<WorkerCrashListener>();
  /** All embedding work shares one worker so the model is loaded exactly once. */
  private embeddingWorkerIndex: number | null = null;
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

  /** Idle non-embedding worker if any; else grow; finally reuse the warm worker. */
  private pickGeneralIdleWorker(): number {
    for (let i = 0; i < this.workers.length; i += 1) {
      if (i !== this.embeddingWorkerIndex && this.workers[i] && this.busy[i] === 0) return i;
    }
    const emptySlot = this.workers.findIndex((w) => w === null);
    if (emptySlot >= 0) return this.spawn(emptySlot);
    if (this.workers.length < this.size) return this.spawn();
    // Only a single-worker pool may lend the pinned embedding worker to general
    // work. Anywhere else this is a bad trade: one wedged parse retires the
    // worker and throws away the loaded model, forcing a full reload on the
    // next embed — and with size >= 2 general jobs always have another slot.
    // On a 1-worker pool there is no other slot, so refusing would starve them.
    if (
      this.size === 1 &&
      this.embeddingWorkerIndex !== null &&
      this.workers[this.embeddingWorkerIndex] &&
      this.busy[this.embeddingWorkerIndex] === 0
    ) {
      return this.embeddingWorkerIndex;
    }
    return -1;
  }

  /**
   * Parsing can scale across the pool. Embedding cannot: every pipeline
   * worker has its own module scope, so concurrent workers would each load
   * and compile a full model session. Pin every embed and embedQuery request
   * to one warm worker instead.
   */
  private pickIdleWorker(jobType: PoolRequest['type']): number {
    const isEmbedding = jobType === 'embed' || jobType === 'embedQuery';
    if (!isEmbedding) return this.pickGeneralIdleWorker();

    if (this.embeddingWorkerIndex !== null) {
      const index = this.embeddingWorkerIndex;
      if (this.workers[index]) return this.busy[index] === 0 ? index : -1;
      this.embeddingWorkerIndex = null;
    }

    const index = this.pickGeneralIdleWorker();
    if (index >= 0) this.embeddingWorkerIndex = index;
    return index;
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

  /**
   * Dispatch every queued job that can run right now, scanning past ones that
   * cannot.
   *
   * Stopping at queue[0] meant one embed job waiting on the pinned (busy)
   * embedding worker held up every parse behind it while general workers sat
   * idle — the first search of a session loads the model for up to three
   * minutes, and a file dropped meanwhile just sat at "queued".
   *
   * FIFO still holds *within* each resource class, which is the only ordering
   * that matters: dispatchability depends solely on a job's class (embed jobs
   * want the one pinned worker, everything else wants any other slot), so
   * skipping a blocked job can never let a later job of that same class jump
   * ahead of it. Once a class is known blocked we stop re-testing it.
   */
  private pump(): void {
    let embedBlocked = false;
    let generalBlocked = false;
    let i = 0;
    while (i < this.queue.length) {
      const job = this.queue[i];
      if (!job) return;
      const isEmbed = job.payload.type === 'embed' || job.payload.type === 'embedQuery';
      if (isEmbed ? embedBlocked : generalBlocked) {
        i += 1;
        continue;
      }
      const index = this.pickIdleWorker(job.payload.type);
      if (index < 0) {
        if (isEmbed) embedBlocked = true;
        else generalBlocked = true;
        if (embedBlocked && generalBlocked) return; // nothing can move
        i += 1;
        continue;
      }
      this.queue.splice(i, 1); // next job shifts into i — don't advance
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
            // A timed-out worker may be permanently wedged. Retire it for
            // every job type so queued work can move to a fresh worker. This
            // deliberately trades a warm embedding model for bounded recovery.
            this.handleWorkerFailure(index, new Error(`${jobType} worker request timed out`));
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
    if (!entry) return;
    this.pending.delete(msg.requestId);
    if (entry.timer) clearTimeout(entry.timer);
    this.busy[entry.workerIndex] = Math.max(0, this.busy[entry.workerIndex] - 1);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
    this.pump();
  }

  private retireWorker(index: number): void {
    const worker = this.workers[index];
    if (worker) worker.terminate();
    this.workers[index] = null;
    this.busy[index] = 0;
    if (this.embeddingWorkerIndex === index) this.embeddingWorkerIndex = null;
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
    for (const job of this.queue) job.reject(error);
    this.queue = [];
    this.workers = [];
    this.busy = [];
    this.embeddingWorkerIndex = null;
    this.progressListeners.clear();
    this.crashListeners.clear();
  }
}

let singleton: WorkerPool | null = null;

export function getPool(): WorkerPool {
  if (!singleton || singleton.isDisposed) singleton = new WorkerPool();
  return singleton;
}
