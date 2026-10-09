import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installObserver, settlementStart } from './browser.mjs';

test('cached graph starts settling when readiness changes without a graph change', () => {
  const graph = 'complete saved graph';
  let start = settlementStart(graph, null, graph, false, 100);
  assert.equal(start, null);
  start = settlementStart(graph, start, graph, true, 200);
  assert.equal(start, 200);
  assert.equal(settlementStart(graph, start, graph, true, 1800), 200);
  assert.equal(settlementStart(graph, start, graph, false, 1900), null);
  assert.equal(settlementStart(graph, null, graph, true, 2000), 2000);
  assert.equal(settlementStart(graph, start, 'changed graph', true, 2100), 2100);
});

test('observer preserves worker messages, tracks progress, and distinguishes cached features from inference', () => {
  const OriginalWorker = globalThis.Worker, OriginalDB = globalThis.IDBDatabase;
  class FakeWorker extends EventTarget {
    postMessage(...args) { this.sent = args; }
    terminate() { this.stopped = true; }
  }
  class FakeDB { transaction() { return new EventTarget(); } }
  globalThis.Worker = FakeWorker; globalThis.IDBDatabase = FakeDB;
  try {
    installObserver();
    const worker = new globalThis.Worker('https://localhost/assets/musicAnalysis.worker-123.js');
    const message = { id: 12, kind: 'profile', samples: new Float32Array([1]) };
    worker.postMessage(message, [message.samples.buffer]);
    assert.equal(worker.sent[0], message);
    assert.equal(globalThis.__dgeBenchmark.pending, 1);
    worker.dispatchEvent(new MessageEvent('message', { data: { id: 12, progress: 'Reusing saved sound features' } }));
    assert.equal(globalThis.__dgeBenchmark.pending, 1);
    worker.dispatchEvent(new MessageEvent('message', { data: { id: 12, result: {}, runtime: { inferenceExecuted: false } } }));
    assert.equal(globalThis.__dgeBenchmark.pending, 0);
    assert.equal(globalThis.__dgeBenchmark.requests[0].inferenceExecuted, false);
    assert.deepEqual(globalThis.__dgeBenchmark.requests[0].progress, ['Reusing saved sound features']);
    worker.postMessage({ id: 13, kind: 'tagger' });
    worker.terminate();
    assert.equal(globalThis.__dgeBenchmark.pending, 0);
    assert.equal(globalThis.__dgeBenchmark.requests[1].failed, true);
    const layout = new globalThis.Worker('https://localhost/assets/layout.worker-123.js');
    layout.postMessage({ id: 1, kind: 'stream' });
    assert.equal(globalThis.__dgeBenchmark.pending, 0);
    const tx = new FakeDB().transaction(['graphs', 'corpora'], 'readwrite');
    tx.dispatchEvent(new Event('complete'));
    assert.equal(globalThis.__dgeBenchmark.transactionMs.length, 1);
    assert.equal(globalThis.__dgeBenchmark.corpusWrites, 1);
  } finally {
    globalThis.Worker = OriginalWorker; globalThis.IDBDatabase = OriginalDB;
    delete globalThis.__dgeBenchmark;
  }
});

test('observer tracks parse and embedding jobs from pipeline worker URLs', () => {
  const OriginalWorker = globalThis.Worker, OriginalDB = globalThis.IDBDatabase;
  class FakeWorker extends EventTarget { postMessage() {} terminate() {} }
  class FakeDB { transaction() { return new EventTarget(); } }
  globalThis.Worker = FakeWorker; globalThis.IDBDatabase = FakeDB;
  try {
    installObserver();
    for (const url of ['https://localhost/src/workers/pipeline.worker.ts', new URL('https://localhost/assets/pipeline.worker-abc123.js')]) {
      const worker = new globalThis.Worker(url);
      for (const [requestId, type] of [[1, 'parse'], [2, 'embedBatch']]) {
        const before = globalThis.__dgeBenchmark.requests.length;
        worker.postMessage({ requestId, type });
        assert.equal(globalThis.__dgeBenchmark.pending, 1);
        worker.dispatchEvent(new MessageEvent('message', { data: { requestId, type: `${type}:progress` } }));
        assert.equal(globalThis.__dgeBenchmark.pending, 1);
        worker.dispatchEvent(new MessageEvent('message', { data: { requestId, type: `${type}:done` } }));
        assert.equal(globalThis.__dgeBenchmark.pending, 0);
        assert.equal(globalThis.__dgeBenchmark.requests.length, before + 1);
        assert.equal(globalThis.__dgeBenchmark.requests.at(-1).kind, type);
      }
    }
  } finally {
    globalThis.Worker = OriginalWorker; globalThis.IDBDatabase = OriginalDB;
    delete globalThis.__dgeBenchmark;
  }
});
