/**
 * Worker pool for the parse/embed pipeline (spec §4.3): up to POOL_SIZE
 * pipeline workers, created lazily, least-busy dispatch, requestId
 * correlation. The pool owns requestId assignment — the requestId on the
 * message passed to request() is overwritten.
 */

import { POOL_SIZE } from '../config';
import type { PoolRequest, PoolResponse } from '../model/types';

export interface ModelProgress {
  loaded: number;
  total: number;
  note: string;
}
type ProgressListener = (progress: ModelProgress) => void;

interface PendingRequest {
  resolve: (response: PoolResponse) => void;
  reject: (error: Error) => void;
  workerIndex: number;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private progressListeners = new Set<ProgressListener>();
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  private spawn(): number {
    const index = this.workers.length;
    const worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<PoolResponse>) => this.handleMessage(ev.data);
    worker.onerror = (ev: ErrorEvent) => this.handleWorkerError(index, ev);
    this.workers.push(worker);
    this.busy.push(0);
    return index;
  }

  /** Idle worker if any; else grow up to POOL_SIZE; else least-busy. */
  private pickWorker(): number {
    for (let i = 0; i < this.workers.length; i += 1) {
      if (this.busy[i] === 0) return i;
    }
    if (this.workers.length < POOL_SIZE) return this.spawn();
    let best = 0;
    for (let i = 1; i < this.workers.length; i += 1) {
      if (this.busy[i] < this.busy[best]) best = i;
    }
    return best;
  }

  request<T extends PoolResponse>(msg: PoolRequest, transfer?: Transferable[]): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('WorkerPool is disposed'));
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const index = this.pickWorker();
    const worker = this.workers[index];
    this.busy[index] += 1;
    const payload = { ...msg, requestId } as PoolRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        // runtime correlation by requestId guarantees the response matches
        // the request; the caller asserts the concrete response type T
        resolve: resolve as unknown as (response: PoolResponse) => void,
        reject,
        workerIndex: index,
      });
      if (transfer && transfer.length > 0) worker.postMessage(payload, transfer);
      else worker.postMessage(payload);
    });
  }

  /** 'model:progress' messages arrive with any requestId (usually -1). */
  onModelProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
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
    this.busy[entry.workerIndex] = Math.max(0, this.busy[entry.workerIndex] - 1);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
  }

  private handleWorkerError(index: number, ev: ErrorEvent): void {
    const error = new Error(ev.message || 'pipeline worker crashed');
    for (const [id, entry] of [...this.pending]) {
      if (entry.workerIndex !== index) continue;
      this.pending.delete(id);
      entry.reject(error);
    }
    this.busy[index] = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const worker of this.workers) worker.terminate();
    const error = new Error('WorkerPool is disposed');
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
    this.workers = [];
    this.busy = [];
    this.progressListeners.clear();
  }
}

let singleton: WorkerPool | null = null;

export function getPool(): WorkerPool {
  if (!singleton || singleton.isDisposed) singleton = new WorkerPool();
  return singleton;
}
