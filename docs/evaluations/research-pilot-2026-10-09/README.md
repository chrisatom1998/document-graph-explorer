# DGE research pilot — 9 October 2026

**Decision: keep the production models unchanged.** The pilot found short-clip
misses and useful reliability checks, but no consistent replacement-model win.
This is a development experiment, not a held-out product accuracy claim.

The implementation is in [`scripts/research`](../../../scripts/research/README.md).
No production UI, models, thresholds, training or paid services were changed.

## What ran

- **45 base clips:** six published MASB attribution windows cropped to 1/2/6/10 s;
  five crops of two licensed Iowa instrument fixtures; and 16 constructed
  pulse/silence controls. Only the original 10 s MASB windows inherit the published
  annotations. Shorter music crops have unknown truth.
- **20 effect controls:** dry, delay, hard-clipping distortion and low-pass filtering
  applied to the two Iowa fixtures, at 1/2/6 s where the source is long enough.
  Labels mean a processor was applied, not that a listener verified its audibility.
- DGE's unchanged built browser app; its unchanged CLAP worker separately;
  PEACE boxgraph; TP-CLAP general and MTAT fine-tuned checkpoints. Python models
  ran frozen, CPU-only, batch size one, with local weights and offline inference.

Source groups never cross splits or query/gallery boundaries. All clips here are
development data. The base/effects manifests, compact run records, score records,
checkpoint hashes and Python environment accompany this report. Audio and weights
are not redistributed. Compact run records omit embedding vectors; rerun the
commands to regenerate vectors for independent rescoring.

## Measured results

### Effect retrieval: no consistent winner

Each positive query ranks four effect variants from the *other* instrument.
There are six queries per duration but only two independent source recordings.

| Encoder / query | 1 s top-1 | 2 s top-1 |
|---|---:|---:|
| Existing DGE CLAP component | 2/6 | 4/6 |
| PEACE boxgraph | 4/6 | 2/6 |
| TP-CLAP general, effect prompt | 2/6 | 3/6 |
| TP-CLAP MTAT, effect prompt (secondary control) | 2/6 | 2/6 |

The marimba fixture is shorter than six seconds. The six-second gallery therefore
has no positive from another source; the scorer correctly reports **no measurable
queries**, not a success or failure. These tiny, correlated, constructed examples
cannot establish a ranking for real DJ effects. PEACE code-to-audio retrieval was
not tested, nor were complete published benchmark results replicated.

### Instrument attribution and detection

On the six published MASB caption pairs, the **general TP-CLAP checkpoint chose
the positive caption 4/6 times; silence chose it 3/6 times**. The MTAT fine-tune
also scored 4/6, but silence scored 5/6. Ties count as wrong. The silence result is
a preference control, not a second set of correctly labelled music. This does not
establish a gain over DGE: its audio-only CLAP worker does not provide the text
encoder required for the same caption-pair experiment.

The DGE browser run completed **43/45** clips. Its first 1 s and 2 s music imports
were partial, with AST reporting `network error`; subsequent imports completed.
Partial results do not receive complete-pipeline accuracy credit.

**Current-runtime follow-up:** main subsequently included the runtime-initialization
fix [#174](https://github.com/chrisatom1998/document-graph-explorer/pull/174),
commit `3c622872c4f59d64c317c8c78204da661b4e94a2`. After merging it, the same two
initial clips both completed, with no page errors: 20.35 s for the cold 1 s clip
and 6.90 s for the subsequent 2 s clip. This two-input smoke check is recorded
separately at commit `02c2d4a9474120672a19fec5ee159fd218202f0f`; it does not replace
the 45-clip study or establish general reliability. The earlier partials describe
the frozen older baseline, not the current runtime.

For the five explicitly labelled Iowa positives, DGE displayed flute on the 6 s
flute crop and missed flute/marimba on all four 1–2 s crops. The inputs contain
signal, with RMS around −31 to −34 dBFS. At 10 s, the published positive labels
give guitar 4/4, violin 1/1, drums 1/1, bass 1/2, synthesizer 1/2 and piano 0/1 detected.
Most other labels are **unknown**, not verified negatives, so those detections
do not establish useful precision or calibration. The scorer's null precision
values and unknown counts must be retained.

A diagnostic outside the planned label score: the generated ten-second all-zero
silence clip received displayed drums, piano, guitar and bass labels. This is a
clear negative-control failure worth investigating; it is not evidence about
the prevalence of false positives in real music.

### Tempo and key controls

Three constructed pulse grids have reference tempos 90, 120 and 174 BPM.

| Duration | Strict tempo within 4% | Half/double-tolerant tempo | Correct no-key abstention, including silence |
|---|---:|---:|---:|
| 1 s | 0/3 | 0/3 | 4/4 |
| 2 s | 2/3 | 2/3 | 4/4 |
| 6 s | 3/3 | 3/3 | 3/4 |
| 10 s | 3/3 | 3/3 | 3/4 |

Silence correctly received no tempo at all four durations. The 90 BPM control
received a major/minor key at 6 and 10 s despite having no reference musical mode.
The full production pipeline can emit one-second tempo estimates even though
one of its individual estimators rejects sub-two-second inputs; component rules
must not be mistaken for the final app's behavior. These are synthetic diagnostics,
not real-music tempo accuracy. No positively labelled key corpus was available,
so exact-key accuracy and weighted related-key accuracy remain unmeasured.

## Speed and reliability

Environment: Linux, AMD EPYC 9V74 host, 9 exposed logical CPUs, approximately
10 GB container memory, Chromium 153.0.8010.0, Node 24.19.0. Python used CPU
inference; PyTorch requested two threads on the general-checkpoint runs. OMP
settings do not constrain every JAX/XLA thread.

| Run | 1 s median | 2 s median | 6 s median |
|---|---:|---:|---:|
| Full DGE browser, successful warm imports | 7.39 s | 6.91 s | 9.68 s |
| DGE CLAP component, warm | 1.26 s | 1.92 s | 3.06 s |
| PEACE effect controls, warm | 0.46 s | 1.41 s | 0.69 s |
| TP-CLAP general effect controls, warm | 0.23 s | 0.30 s | 0.56 s |

**These figures do not establish a speedup.** Browser timings include decoding,
all model jobs, graph persistence, polling and a 1.5 s stability wait. Component
timings have smaller boundaries and different preprocessing/runtime costs.
Cold initialization is separate, sample sizes are small, and tests/model runs
overlapped on the shared machine. The audit files retain individual durations,
cold/warm flags, failure states, worker runtime details and observed percentiles.
Here “warm” means subsequent clips in the same process; input shapes were not
prewarmed, so a later JAX row may still include shape-specific compilation.

Two earlier browser attempts encountered container memory pressure. The full
effect-app run crashed and was not scored as successful. The component CLAP
comparison subsequently completed all 20 controls. An independent deadline was
added to the harness so a crashed browser cannot leave an unbounded import wait.

## Revisions, availability and evidence limits

- [MASB code/data](https://github.com/barry-mir/music-clap-bow), commit
  `9dd9338790f3b195fa984e888f6e57f93b5cd949`; author-provided annotations and
  downloadable source tracks. This pilot uses only six of the benchmark pairs.
- [PEACE code](https://github.com/DBraun/PEACE), commit
  `2d8a3887501bcdb4779544295845b1e69b6b9b78`; [weights](https://huggingface.co/davidbraun/peace),
  revision `484fe3cbf4a21226f0989fbbcadb126c59ec34ef`. MIT code; CC BY-NC 4.0 weights.
  Product use would require resolving the noncommercial weights license.
- [TP-CLAP code](https://github.com/mohan-li/TP-CLAP), commit
  `39455a4fe4710e27eedf53a5598a6ae6404d0382`; [weights](https://huggingface.co/mohanli/TP-CLAP),
  revision `b14090f5210715958f5ab7056d3c47f5f61cb582`. Apache-2.0 code/model card;
  pinned CED and BERT backbone identities are in the download script.
- DGE base commit `fbf46ebd3db42f828104a9b0e98052f1052adde0`.
  Iowa fixture permission and provenance are committed with the fixtures.

## Next experiments justified by this pilot

1. **Build the reviewed 1–2 s acceptance set before tuning.** Include quiet
   positives, vocal-chop/synth confusions, drum-pattern variants, real effects,
   difficult negatives and silence. Split by original recording, calibrate only
   on development sources, and freeze the test set. Expected benefit: trustworthy
   per-category precision/recall and abstention measurements. Effort: medium,
   dominated by annotation, with no training required for the initial comparison.
2. **Profile the unchanged app on an idle target machine.** Repeat fresh and warm
   sessions at least 30 times, measure batch throughput, p50/p95, full process
   memory, and successful completion for CPU/WASM and available GPU paths.
   Expected benefit: identify whether initialization, decoding, models or graph
   work actually limits processing speed. Effort: low to medium.
3. **Expand effect retrieval before integrating a candidate.** Use many independent
   sources and human-verified audible effects; compare CLAP, PEACE and TP-CLAP
   with the same gallery and preprocessing. Expected benefit: determine whether
   PEACE adds repeatable effect information. Effort: medium; preserve current
   production models unless accuracy and latency both pass the project-specific gate.

## Verification

Build, repository lint and TypeScript checks passed. The new harness has four
passing focused tests, covering unknown/failed predictions, altered bytes,
source-group leakage, attribution ties and retrieval exclusions. Python scripts
compile. The full existing suite reported 2,658 passed, one skipped and one
600-second timeout in the unrelated 61-PEP graph-accuracy test. An isolated retry
also remained incomplete and was stopped; no pass is inferred. That existing
test timeout remains unresolved. Details are recorded in `verification.json`.
The build was repeated successfully after merging the current-main runtime fix;
its two focused tests and the two-input browser smoke also passed.
