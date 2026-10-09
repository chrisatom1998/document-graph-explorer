# Mac pilot: real but incomplete

Run 2026-10-09 against PR #172 app commit `e3f50c908a96a1b4e287f0f409b1cd4d47f42877`.
The original Mac checkout and its untracked work were preserved. A separate temporary worktree ran the production app in a fresh Chromium profile.

## Outcome

All 20 fixed ID-hash/artist-disjoint benchmark clips completed the current detector stack. Two Luna and two GPT-Audio inference requests were made. The second GPT-Audio response failed existing validation, so the frozen evaluator stopped without retries. One development clip is paired; no held-out audio comparisons were reached.

| Frozen variant | Paired development clips | TP | FP | Misses | Micro F1 |
|---|---:|---:|---:|---:|---:|
| Current detector | 1 | 1 | 0 | 0 | 100% |
| GPT-Audio alone | 1 | 0 | 0 | 1 | 0% |
| Union | 1 | 1 | 0 | 0 | 100% |
| Agreement | 1 | 0 | 0 | 1 | 0% |
| Native-unless-empty fallback | 1 | 1 | 0 | 0 | 100% |
| Luna normalization | 1 | 1 | 0 | 0 | 100% |
| Luna routing | 1 | 0 | 0 | 1 | 0% |

The sole annotated positive on the paired clip is organ. Native finds it; audio, agreement, and Luna routing miss it. Other predictions have no annotations on that clip and cannot be counted as false positives. This is a regression observation, not an estimate of model accuracy. All variants use identical paired coverage and exclude the failed response. Abstentions are zero on the successful pair.

## Native baseline, separately scored

| Split | Clips | Annotated positives | TP / FP / FN | Precision / Recall / F1 |
|---|---:|---:|---|---|
| Development | 10 | 8 | 7 / 0 / 1 | 100% / 87.5% / 93.3% |
| Held-out | 10 | 6 | 6 / 0 / 0 | 100% / 100% / 100% |

These 20-clip baseline scores are separate from the one-clip paired comparison. Only explicitly present/absent instrument annotations count. The 20 clips contain only 14 positive and 12 negative class annotations. Per-category counts, precision/recall/F1, the guitar miss, and runtime evidence are in `native-baseline-report.json`. Unknown classes are ignored. The held-out baseline has only six positive annotations; its perfect score does not establish reliability. Descriptive pooled Wilson intervals are in `analysis.json`; they ignore within-clip correlation. DJ effects and character accuracy remain unproven.

## Spend and performance

Usage-derived conservative standard-rate estimate: **$0.014767625** for all four requests, including the invalid completion, below the $5 limit. This is not invoice-confirmed spend. Budget reservations were released only after usage was known. No credentials, request audio, or request headers are included.

Audio: 2,546 input tokens (200 audio tokens), 129 output tokens. Luna: 8,313 input and 347 output tokens; cached input is recorded but the estimate conservatively charges cache-write input rates.

Audio request latencies: 1,888 and 1,607 ms (including excerpt preparation). Luna: 3,917 and 2,511 ms. Native median was 10.0835 seconds and maximum 54.372 seconds; all 20 clips produced source labels. Native per-clip file-picker-to-terminal timings and actual worker runtime are in the baseline report; first-clip model loading and polling/export overhead are included, so these are not equivalent latency boundaries. Inference used WASM, one thread, in Chromium with SwiftShader rendering.

## Failure and recommendation

The second completion returned usage and then failed existing validation. The original runner stored only `Error` and null HTTP status, not response text or a validation reason, so the exact schema defect cannot be recovered without another request. No retry was made. Future runs now checkpoint bounded provider text/finish reason for offline diagnostics; validation and acceptance rules remain unchanged.

**Retain existing acceptance thresholds and policies.** There is no held-out audio evidence supporting a policy change. Completing the comparison requires valid results for the remaining untouched clips and a documented continuation plan that preserves the failed attempt, frozen selection/splits, no retries, and cumulative $5 cap.

`report.json` and `responses.json` are original checkpoints. `runner-source.txt` is the SHA-256-matched source actually executed. Later runner changes record detector timing and zero-cost local shortcuts, and capture bounded provider responses for failure diagnosis; they do not alter this run or any product acceptance threshold.

## Local validation

Full regression: 344 files passed, one failed; 2,694 tests passed, one failed, one skipped. The unchanged Python-PEP graph-clustering check at `src/eval/graphAccuracy.test.ts:418` expects at least 198 pairs and produces 193 on this Mac; it reproduced in two full runs. No graph code or test thresholds were changed. The first sandbox run also had loopback `EPERM` errors; the loopback-enabled rerun removed all server-test failures.

Affected audio/server checks: 46 tests passed, with another 42-test focused run also passing. Evaluator scoring/budget checks: eight passed. Lint, type checks, production build/runtime checks, air-gapped build/runtime/CSP checks, and both bundle budgets passed. A credential containment check passed for deliverables. See `validation.json`.
