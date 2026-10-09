import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installObserver } from './browser.mjs';

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
