/**
 * Pool scheduling contract: jobs queue inside the pool and are dispatched
 * one-at-a-time per worker, so a request's timeout measures processing time,
 * not time spent waiting behind other jobs — and a worker failure takes down
 * only its in-flight request, never the queued backlog. (Regression: a large
 * drop used to post every job up front; tail jobs hit their enqueue-time
 * timeouts while still waiting, cascade-failing healthy documents.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool, type PipelineWorkerLike } from './pool';
import type { ParsedDoc, PoolRequest, PoolResponse } from '../model/types';

function makeDoc(): ParsedDoc {
  return {
    contentHash: 'h',
    title: 't',
    text: 'x',
    wordCount: 1,
    headings: [],
    mdLinkTargets: [],
    docLinks: [],
    entities: [],
    tf: {},
    totalTerms: 1,
    chunks: [],
    status: 'ok',
  };
}

function parseMsg(): PoolRequest {
  return {
    requestId: 0,
    type: 'parse',
    fileId: 'f',
    name: 'a.txt',
    fileType: 'txt',
    bytes: new ArrayBuffer(0),
  };
}

class FakeWorker implements PipelineWorkerLike {
  messages: PoolRequest[] = [];
  onmessage: ((ev: MessageEvent<PoolResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  terminated = false;
  postMessage(message: unknown): void {
    this.messages.push(message as PoolRequest);
  }
  terminate(): void {
    this.terminated = true;
  }
  respondToLast(): void {
    const msg = this.messages[this.messages.length - 1];
    this.onmessage?.({
      data: { requestId: msg.requestId, type: 'parse:done', fileId: 'f', doc: makeDoc() },
    } as MessageEvent<PoolResponse>);
  }
  crash(): void {
    this.onerror?.({ message: 'boom' } as ErrorEvent);
  }
}

describe('WorkerPool scheduling', () => {
  let workers: FakeWorker[];
  let pool: WorkerPool;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    pool = new WorkerPool({
      size: 1,
      workerFactory: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
    });
  });

  afterEach(() => {
    pool.dispose();
    vi.useRealTimers();
  });

  it('resolves a request with the correlated worker response', async () => {
    const p = pool.request(parseMsg());
    expect(workers).toHaveLength(1);
    expect(workers[0].messages).toHaveLength(1);
    workers[0].respondToLast();
    await expect(p).resolves.toMatchObject({ type: 'parse:done' });
  });

  it('holds excess jobs in the pool queue instead of stacking a busy worker', () => {
    pool.request(parseMsg()).catch(() => {});
    pool.request(parseMsg()).catch(() => {});
    expect(workers).toHaveLength(1);
    // second job waits in the pool, not in the worker's message queue
    expect(workers[0].messages).toHaveLength(1);
  });

  it("starts a job's timeout at dispatch, not enqueue", async () => {
    const first = pool.request(parseMsg());
    const second = pool.request(parseMsg());
    // attach the handler before the clock advances so the rejection is
    // observed the moment it happens (no unhandled-rejection window)
    const firstTimesOut = expect(first).rejects.toThrow(/timed out/);
    // the in-flight job hangs: it times out and its worker is retired…
    await vi.advanceTimersByTimeAsync(30_001);
    await firstTimesOut;
    // …but the queued job was never dispatched, so it must survive the
    // 30s mark and run to completion on a replacement worker
    expect(workers).toHaveLength(2);
    expect(workers[1].messages).toHaveLength(1);
    workers[1].respondToLast();
    await expect(second).resolves.toMatchObject({ type: 'parse:done' });
  });

  it('a worker crash rejects only its in-flight job; queued jobs continue', async () => {
    const first = pool.request(parseMsg());
    const second = pool.request(parseMsg());
    workers[0].crash();
    await expect(first).rejects.toThrow();
    expect(workers).toHaveLength(2);
    workers[1].respondToLast();
    await expect(second).resolves.toMatchObject({ type: 'parse:done' });
  });

  it('dispose rejects queued jobs as well as in-flight ones', async () => {
    const first = pool.request(parseMsg());
    const second = pool.request(parseMsg());
    pool.dispose();
    await expect(first).rejects.toThrow(/disposed/);
    await expect(second).rejects.toThrow(/disposed/);
  });
});
