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

function embedMsg(): PoolRequest {
  return { requestId: 0, type: 'embed', docId: 'd', chunks: ['x'] };
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
  respondEmbedToLast(): void {
    const msg = this.messages[this.messages.length - 1];
    this.onmessage?.({
      data: {
        requestId: msg.requestId,
        type: 'embed:done',
        docId: 'd',
        docVector: new Float32Array(0),
        chunkVectors: new Float32Array(0),
        nChunks: 0,
      },
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

  it('serializes embeddings onto one warm worker even when the pool can grow', async () => {
    pool.dispose();
    workers = [];
    pool = new WorkerPool({
      size: 3,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });

    const first = pool.request(embedMsg());
    const second = pool.request(embedMsg());

    expect(workers).toHaveLength(1);
    expect(workers[0].messages).toHaveLength(1);
    workers[0].respondEmbedToLast();
    await expect(first).resolves.toMatchObject({ type: 'embed:done' });

    expect(workers).toHaveLength(1);
    expect(workers[0].messages).toHaveLength(2);
    workers[0].respondEmbedToLast();
    await expect(second).resolves.toMatchObject({ type: 'embed:done' });
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

  it('retires a timed-out embed worker so queued embeddings can recover', async () => {
    const first = pool.request(embedMsg());
    const firstTimesOut = expect(first).rejects.toThrow(/timed out/);
    // embed's timeout (180s) is much longer than parse's (30s) — advance
    // past it without ever hitting parse's shorter window.
    await vi.advanceTimersByTimeAsync(180_001);
    await firstTimesOut;
    expect(workers[0].terminated).toBe(true);

    const second = pool.request(embedMsg());
    expect(workers).toHaveLength(2);
    expect(workers[1].messages).toHaveLength(1);
    workers[1].respondEmbedToLast();
    await expect(second).resolves.toMatchObject({ type: 'embed:done' });
  });

  it('dispose rejects queued jobs as well as in-flight ones', async () => {
    const first = pool.request(parseMsg());
    const second = pool.request(parseMsg());
    pool.dispose();
    await expect(first).rejects.toThrow(/disposed/);
    await expect(second).rejects.toThrow(/disposed/);
  });

  it('lets the only worker take general work once its embed finishes', () => {
    // size 1: refusing here would starve parses forever on a 2-core machine.
    pool.request(embedMsg()).catch(() => undefined);
    workers[0].respondEmbedToLast();

    void pool.request(parseMsg()).catch(() => undefined);

    expect(workers[0].messages.map((m) => m.type)).toEqual(['embed', 'parse']);
  });
});

describe('WorkerPool dispatch past blocked jobs', () => {
  let workers: FakeWorker[];
  let pool: WorkerPool;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    pool = new WorkerPool({
      size: 2,
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

  it('runs a parse while an embed waits on the busy pinned worker', () => {
    void pool.request(embedMsg()).catch(() => undefined); // pins and occupies worker 0
    void pool.request(embedMsg()).catch(() => undefined); // queued: the pinned worker is busy
    void pool.request(parseMsg()).catch(() => undefined); // must not wait behind it

    expect(workers).toHaveLength(2);
    expect(workers[1].messages.map((m) => m.type)).toEqual(['parse']);
  });

  it('keeps FIFO order within a class when an earlier job is skipped', () => {
    void pool.request(embedMsg()).catch(() => undefined);
    void pool.request(embedMsg()).catch(() => undefined); // blocked at the head of the queue
    const firstParse = { ...parseMsg(), fileId: 'first' };
    const secondParse = { ...parseMsg(), fileId: 'second' };
    void pool.request(firstParse).catch(() => undefined);
    void pool.request(secondParse).catch(() => undefined);

    // Two parses, one free worker: the earlier one must go first.
    expect(workers[1].messages[0]).toMatchObject({ type: 'parse', fileId: 'first' });
    workers[1].respondToLast();
    expect(workers[1].messages[1]).toMatchObject({ type: 'parse', fileId: 'second' });
  });

  it('never hands a parse to the pinned embedding worker when other slots exist', () => {
    void pool.request(embedMsg()).catch(() => undefined);
    workers[0].respondEmbedToLast(); // worker 0 pinned but now idle
    void pool.request(parseMsg()).catch(() => undefined);
    void pool.request(parseMsg()).catch(() => undefined);

    // Both parses belong on worker 1, queueing there rather than retiring the
    // warm model on worker 0.
    expect(workers[0].messages.every((m) => m.type === 'embed')).toBe(true);
    expect(workers[1].messages.map((m) => m.type)).toEqual(['parse']);
  });
});
