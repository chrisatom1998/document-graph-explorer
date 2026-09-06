# Performance benchmarks

Measured 2026-08-05 at commit `08e8311` on an Apple M5 Max (36 GB RAM),
macOS 27, in the Chromium-based embedded browser at 1280×800 with a 120 Hz
display. Numbers are medians unless noted. Synthetic corpora mirror the demo
corpus shape: one cluster per ~15 nodes and ~4.2 edges per node, 85%
intra-cluster.

Reproduce the layout benchmark with `npm run bench:layout`; the browser-side
procedures are described inline below. See also
[retrieval-benchmark-2026-07-11.json](retrieval-benchmark-2026-07-11.json)
for the separate search-quality benchmark.

## Ingest pipeline (end-to-end)

Demo corpus, cold page load with a warm embedding-model cache, timed from the
**Load demo corpus** click to pipeline phase `ready` (parse → tokenize → embed
→ lexical/semantic linking → Louvain clustering → layout hydration):

| Corpus | Wall time | Throughput |
| --- | --- | --- |
| 100 PDF documents → 202 nodes, 850 edges, 13 clusters | 9.2 s | ~11 docs/s |

All stages run in browser workers (pdf.js text extraction on the main
thread); nothing leaves the tab. A cold embedding-model download adds a
one-time cost not measured here.

## Layout convergence (production worker, headless)

`npm run bench:layout` drives the real `src/workers/layout.worker.ts` through
its own message protocol with the worker global stubbed — the exact production
force configuration and settle detection, no reimplementation. d3's stepper
paces ticks with `setTimeout` (~17 ms) both here and in a browser worker, so
small graphs are timer-bound and large ones show true compute cost. Time is
from the `add` message to the worker's `settled` message (alpha < 0.005),
median of 3 runs:

| Nodes | Edges | Settle time | vs. timer-bound floor |
| --- | --- | --- | --- |
| 100 | 420 | 4.07 s | — (floor) |
| 250 | 1,050 | 4.22 s | +0.15 s |
| 500 | 2,100 | 4.48 s | +0.41 s |
| 1,000 | 4,200 | 4.97 s | +0.90 s |
| 2,000 | 8,400 | 5.93 s | +1.86 s |

Read: convergence needs ~240 ticks regardless of size, so up to ~250 nodes
the wall time is pure timer pacing. Per-tick force computation (n-body via
octree, link, collide, shell, cluster) stays cheap enough that even at 2,000
nodes — half the initial instanced-mesh capacity of 4,096 — the whole layout
settles in under 6 s. (Node capacity now grows on demand up to a 32,768 hard
ceiling; pass larger sizes explicitly, e.g. `npm run bench:layout -- 4096 8192`.)

## Render frame rate

`requestAnimationFrame` sampled over 5 s on the settled scene (full effect
stack at the auto-quality tier the app selected; no interaction during
sampling). Synthetic corpora imported via the graph-JSON path:

| Nodes | Edges | FPS |
| --- | --- | --- |
| 202 (demo) | 850 | 120.2 |
| 500 | 2,100 | 120.1 |
| 1,000 | 4,200 | 120.0 |
| 2,000 | 8,400 | 119.8 |

The renderer holds the display's 120 Hz cap across the full sweep — the
instanced-mesh scene (single draw call for node cores, batched edge
geometry) never exceeds frame budget at these sizes on this hardware. FPS is
display-capped, so true headroom above 120 is not visible in this
measurement; the app's `AutoQuality` tier system degrades effects before
dropping frames on weaker GPUs.

## OpenUSD export

`buildUsdaStage()` (serialize the full graph — prims, attributes, edge
curves, hulls, variants — to `.usda` text) measured in-page:

| Nodes | Edges | Stage size | Build time |
| --- | --- | --- | --- |
| 202 | 850 | 440 KB | 2.8 ms |
| 500 | 2,100 | 726 KB | 4.4 ms |
| 1,000 | 4,200 | 1.42 MB | 9.9 ms |
| 2,000 | 8,400 | 2.86 MB | 19.4 ms |

Linear in corpus size; export cost is negligible next to a single layout
tick. Downstream, `usd_pipeline.py usdz` flattens the 202-node stage from
440 KB text to a 105 KB binary package.

## Caveats

- Single machine, single browser engine; treat as one calibrated data point,
  not a cross-platform claim.
- Layout benchmark runs under Node's JIT rather than the browser's; both are
  V8, but absolute per-tick costs can differ slightly.
- FPS was display-capped at 120 Hz throughout — the sweep bounds the corpus
  sizes at which the frame budget is met, not maximum render throughput.
- Ingest timing used a warm embedding-model cache (the model is bundled and
  cached after first use).
