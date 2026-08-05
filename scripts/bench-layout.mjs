/**
 * Layout-convergence benchmark: how long does the force layout take to settle
 * as the corpus grows? Results feed docs/benchmarks.md.
 *
 * Runs the REAL production worker (src/workers/layout.worker.ts) headless by
 * stubbing the worker global and driving its own message protocol — no
 * reimplementation, so force constants and settle detection can't drift from
 * what ships. d3's internal stepper paces ticks with setTimeout(~17ms) both
 * here and in a browser worker (no rAF in workers), so wall-clock behavior is
 * representative: small graphs are timer-bound, large ones compute-bound.
 *
 * Synthetic graphs mirror the demo corpus shape: ~1 cluster per 15 nodes,
 * ~4.2 edges per node, mostly intra-cluster.
 *
 *   npm run bench:layout                               # default sweep
 *   npx vite-node scripts/bench-layout.mjs -- 100 500  # custom sizes
 */

const listeners = [];
const selfStub = {
  postMessage(msg) {
    for (const l of listeners) l(msg);
  },
  onmessage: null,
};
globalThis.self = selfStub;

// Import AFTER the stub exists — the worker module registers self.onmessage
// and constructs its simulation at module scope. vite-node transforms the TS.
await import('../src/workers/layout.worker.ts');

function send(msg) {
  selfStub.onmessage?.({ data: msg });
}

function waitForSettle() {
  const start = performance.now();
  let posts = 0;
  return new Promise((resolve) => {
    const listener = (msg) => {
      if (msg.type === 'tick') {
        posts++;
        // Return the transferable so the worker's buffer pool behaves as in prod.
        if (msg.buffer) send({ type: 'returnBuffer', buffer: msg.buffer });
      } else if (msg.type === 'settled') {
        listeners.splice(listeners.indexOf(listener), 1);
        resolve({ ms: performance.now() - start, posts });
      }
    };
    listeners.push(listener);
  });
}

/** Demo-corpus-shaped synthetic graph: clustered, ~4.2 edges/node. */
function makeGraph(n) {
  const clusters = Math.max(4, Math.round(n / 15));
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    slot: i,
    cluster: i % clusters,
  }));
  const links = [];
  const edgeTarget = Math.round(n * 4.2);
  let attempts = 0;
  const seen = new Set();
  while (links.length < edgeTarget && attempts < edgeTarget * 20) {
    attempts++;
    const a = Math.floor(Math.random() * n);
    // 85% intra-cluster (same residue class), 15% anywhere
    const b =
      Math.random() < 0.85
        ? (a + clusters * (1 + Math.floor(Math.random() * Math.max(1, n / clusters - 1)))) % n
        : Math.floor(Math.random() * n);
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: `n${a}`, target: `n${b}`, weight: 0.3 + Math.random() * 0.7 });
  }
  return { nodes, links };
}

async function runOnce(n) {
  const { nodes, links } = makeGraph(n);
  const settled = waitForSettle();
  send({ type: 'add', nodes });
  send({ type: 'links', links });
  send({
    type: 'clusters',
    clusterOf: Object.fromEntries(nodes.map((nd) => [nd.id, nd.cluster])),
  });
  const result = await settled;
  // Clear via the real protocol so the next size starts clean.
  send({ type: 'remove', ids: nodes.map((nd) => nd.id) });
  return result;
}

const argSizes = process.argv
  .slice(2)
  .map(Number)
  .filter((v) => v > 0);
const sizes = argSizes.length > 0 ? argSizes : [100, 250, 500, 1000, 2000];
const ITERATIONS = 3;

console.log(`layout convergence benchmark — sizes: ${sizes.join(', ')} (${ITERATIONS} runs each)`);
console.log('size\truns (ms)\tmedian ms\tposition posts (median)');
for (const n of sizes) {
  const runs = [];
  for (let i = 0; i < ITERATIONS; i++) runs.push(await runOnce(n));
  const byMs = [...runs].sort((a, b) => a.ms - b.ms);
  const median = byMs[Math.floor(runs.length / 2)];
  console.log(
    `${n}\t${runs.map((r) => Math.round(r.ms)).join(', ')}\t${Math.round(median.ms)}\t${median.posts}`,
  );
}
process.exit(0);
