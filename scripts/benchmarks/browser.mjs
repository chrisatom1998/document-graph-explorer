import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectGraph } from './core.mjs';

// Observes messages without changing request payloads, inference, or app state.
export function installObserver() {
  const g = globalThis;
  const stats = g.__dgeBenchmark = { requests: [], pending: 0, longTasks: [], transactionMs: [], corpusWrites: 0, epoch: 0 };
  const NativeWorker = g.Worker;
  g.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      const pending = new Map();
      const finish = (key, data) => {
        const request = pending.get(key);
        if (!request) return;
        pending.delete(key); stats.pending--;
        if (request.epoch === stats.epoch) stats.requests.push({ kind: request.kind, ms: performance.now() - request.start,
          inferenceExecuted: data?.runtime?.inferenceExecuted ?? null, runtime: data?.runtime ?? null,
          failed: !!data?.error || data?.type === 'error', progress: request.progress });
      };
      this.addEventListener('message', ({ data }) => {
        if (!data) return;
        const key = data.requestId === undefined ? `id:${data.id}` : `request:${data.requestId}`;
        if (data.progress || data.type?.endsWith(':progress')) {
          const request = pending.get(key);
          if (request && typeof data.progress === 'string') request.progress.push(data.progress);
        } else finish(key, data);
      });
      this.addEventListener('error', () => { for (const key of pending.keys()) finish(key, { error: true }); });
      const post = this.postMessage.bind(this);
      this.postMessage = (...args) => {
        const data = args[0], id = data?.requestId ?? data?.id;
        const kind = data?.kind ?? data?.type;
        // Layout streams and third-party workers have different lifetimes; don't count them as jobs.
        const observed = /musicAnalysis|aggregator|pool/.test(String(url)) && id !== undefined && kind && kind !== 'cancel';
        const key = data?.requestId === undefined ? `id:${id}` : `request:${id}`;
        if (observed) { pending.set(key, { start: performance.now(), kind, epoch: stats.epoch, progress: [] }); stats.pending++; }
        try { return post(...args); } catch (error) { if (observed) finish(key, { error: true }); throw error; }
      };
      const terminate = this.terminate.bind(this);
      this.terminate = () => { for (const key of pending.keys()) finish(key, { error: true }); return terminate(); };
    }
  };
  const transaction = g.IDBDatabase.prototype.transaction;
  g.IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args), start = performance.now(), epoch = stats.epoch;
    if (args[1] === 'readwrite') tx.addEventListener('complete', () => {
      if (epoch === stats.epoch) {
        stats.transactionMs.push(performance.now() - start);
        if ([args[0]].flat().includes('corpora')) stats.corpusWrites++;
      }
    }, { once: true });
    return tx;
  };
  if (g.PerformanceObserver?.supportedEntryTypes.includes('longtask')) {
    new g.PerformanceObserver(list => {
      for (const entry of list.getEntries()) stats.longTasks.push({ start: entry.startTime, ms: entry.duration });
    }).observe({ type: 'longtask' });
  }
}

// Runs in the browser; only one corpus exists in each isolated benchmark profile.
export async function savedGraph(full = false) {
  const g = globalThis;
  const db = await new Promise((resolve, reject) => {
    const request = g.indexedDB.open('knowledge-nebula');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (!db.objectStoreNames.contains('corpora')) return null;
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction('corpora').objectStore('corpora').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const graph = records.sort((a, b) => b.updatedAt - a.updatedAt).find(r => r.exportData)?.exportData;
    if (!graph || full) return graph ?? null;
    return { nodes: graph.nodes.map(n => ({ path: n.path, title: n.title,
      audio: n.audio ? { stage: n.audio.stage, recognition: { status: n.audio.recognition?.status } } : undefined })),
    edges: { length: graph.edges.length } };
  } finally { db.close(); }
}

export async function importBatch(page, paths, files, timeoutMs) {
  const picker = page.locator('body > input[type="file"][multiple]');
  if (!await picker.count()) {
    page.once('filechooser', () => {});
    await page.getByRole('button', { name: 'Add files', exact: true }).click({ timeout: 30_000 });
  }
  await page.evaluate(() => {
    const stats = globalThis.__dgeBenchmark;
    stats.epoch++; stats.requests = []; stats.longTasks = []; stats.transactionMs = []; stats.corpusWrites = 0;
  });
  const started = performance.now();
  const deadline = started + timeoutMs;
  let last = null, stableSince = null, previous = '';
  let peakJsHeapBytes = null;
  await picker.setInputFiles(paths, { timeout: Math.min(timeoutMs, 120_000) });
  while (performance.now() < deadline) {
    // Bound all reads, including a page stalled by a main-thread regression.
    last = await page.evaluate(savedGraph);
    const state = inspectGraph(last, files);
    const metrics = await page.evaluate(() => ({ pending: globalThis.__dgeBenchmark.pending, corpusWrites: globalThis.__dgeBenchmark.corpusWrites,
      heap: performance.memory?.usedJSHeapSize ?? null }));
    if (metrics.heap !== null) peakJsHeapBytes = Math.max(peakJsHeapBytes ?? 0, metrics.heap);
    const ready = await page.getByRole('button', { name: 'Search documents' }).isEnabled().catch(() => false);
    const signature = JSON.stringify(state);
    // A fresh corpus write proves this handoff actually settled. An unchanged
    // cached graph alone must not finish a slow reimport before it starts.
    if (ready && state.terminal && metrics.pending === 0 && metrics.corpusWrites > 0) {
      if (signature !== previous) stableSince = performance.now();
      if (stableSince !== null && performance.now() - stableSince >= 1500) break;
    } else stableSince = null;
    previous = signature;
    await page.waitForTimeout(500);
  }
  const summary = inspectGraph(last, files);
  const stats = await page.evaluate(() => globalThis.__dgeBenchmark);
  return { elapsedMs: performance.now() - started, timedOut: performance.now() >= deadline,
    ...summary, peakJsHeapBytes, stats };
}

export async function exportGraph(page, output) {
  const menu = page.getByRole('button', { name: 'Data options' });
  if (await menu.count()) await menu.click();
  else await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Export', exact: true }).evaluate(b => b.click());
  const pending = page.waitForEvent('download', { timeout: 30_000 });
  pending.catch(() => {});
  await page.getByRole('button', { name: /Export graph JSON/ }).evaluate(b => b.click());
  await (await pending).saveAs(join(output, 'graph-export.json'));
  return JSON.parse(readFileSync(join(output, 'graph-export.json'), 'utf8'));
}

export function writeReport(path, report) {
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
}
