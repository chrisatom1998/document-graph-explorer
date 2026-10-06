# Short-clip heads trained on public data (2026-10-05)

Adds four one-shot heads for sounds the app could not name on short clips: **reverberant, distorted, beatbox, brass**
(brass is emitted as the existing catalog label `horn`, which `short-clip-displayed.mjs` already scores as `source:brass`).
The 20 heads already in `short-clip.json` are unchanged; the new heads are re-expressed in its standardisation (max logit difference 3e-5 on calibration fingerprints).

## Training data (all public, licence recorded per item)

| Source | Licence | Used for |
|---|---|---|
| FSD50K dev, CC0 / CC BY 3.0 clips only (no CC BY-NC, no Sampling+), uploaders disjoint from calibration and test | per-clip CC0 / CC BY | 5,547 clips, FSD_RULES labels; also beatbox negatives |
| NSynth **train** notes (instruments disjoint from NSynth test), first 1.0 / 2.0 s | CC BY 4.0 | 5,459 notes from 923 instruments: brass, effects (NSynth quality tags) |
| AVP, train-bucket participants only | CC BY 4.0 | 239 vocal-percussion onsets |
| EGFxSet clean / RAT / TubeScreamer / BluesDriver / Hall / Plate / Spring reverb | CC BY 4.0 | 1,680 guitar notes, distorted / reverberant |

Not used: IDMT-SMT audio effects (CC BY-NC-ND forbids derivatives). Every training item is checked against `reserved-test-families.json` (ids, uploaders, NSynth instruments, AVP participants).
Selection: group 5-fold out-of-fold over train + calibration (`development-selection-public-data.json`); test never read for selection.

## Re-measured baseline

The benchmark audio was rebuilt from the public sources by manifest id (`scripts/public-training/materialize.py`); all 2,254 test + calibration clips match the recorded peak levels.
The pre-merge v2 build re-measured in a Linux headless Chromium: **13/27** meet 70/70, 24 of 29 rows identical to `results/v2-report.json` and the rest within 1–2 clips (`results/rerun-baseline-2026-10-05-report.json`).

## Results on the frozen test split (real app uploads)

| Category | Emitted label | Baseline P / R | With new heads P / R | TP / FP / FN | 95% CI P / R |
|---|---|---|---|---|---|
| effect:reverberant | `reverberant` | — / 0.00 | 0.84 / 0.78 | 61 / 12 / 17 | [0.62, 0.974] / [0.583, 0.94] |
| effect:distorted | `distorted` | — / 0.00 | 0.73 / 0.65 | 32 / 12 / 17 | [0.441, 0.909] / [0.426, 0.833] |
| source:brass | `horn (brass)` | — / 0.00 | 0.88 / 0.85 | 35 / 5 / 6 | [0.606, 1.0] / [0.679, 0.955] |
| role:beatbox | `beatbox` | — / 0.00 | 1.00 / 0.06 | 7 / 0 / 104 | [1.0, 1.0] / [0.027, 0.101] |
| role:bass hit | `bass hit (not shipped, see below)` | — / 0.00 | 0.89 / 0.89 | 48 / 6 / 6 | [0.743, 0.966] / [0.78, 0.962] |

Measured on a build of the pre-merge v2 model plus these heads (`results/public-new-coverage-report.json`): **16/27** categories meet 70/70 vs **13/27**, every previously measured row unchanged except voice (+2 found) and vocal one-shot (+8 found via beatbox). Clips with no scored tag: 488 → 158.
Under the current 60/60 bar, distorted (0.73 / 0.65) also passes.

`main` has since gained its own retrained bass-hit and synth-hit heads; this change keeps those and adds only the four heads above. A confirming test run of the merged build is reported in the PR.

### Full retrain (not shipped)

Retraining all heads from this public pool alone scored **12/27** (`results/public-full-retrain-report.json`): it lost cymbal, cowbell and bass guitar (too few public positives: 20, 16, 18) and guitar / piano / tambourine recall. So only new-coverage heads are added.

| Category | Baseline P / R | Full public retrain P / R |
|---|---|---|
| effect:distorted | — / 0.00 | 0.73 / 0.65 |
| effect:reverberant | — / 0.00 | 0.84 / 0.78 |
| role:bass hit | — / 0.00 | 0.89 / 0.89 |
| role:beatbox | — / 0.00 | 1.00 / 0.06 |
| role:clap | 0.81 / 0.87 | 0.78 / 0.93 |
| role:cowbell | 1.00 / 0.57 | — / 0.00 |
| role:cymbal | 1.00 / 0.73 | — / 0.00 |
| role:finger snap | 1.00 / 0.71 | 1.00 / 0.71 |
| role:hi-hat | 1.00 / 0.87 | 1.00 / 0.83 |
| role:impact | 0.94 / 0.67 | 0.86 / 0.68 |
| role:kick | 0.97 / 0.91 | 1.00 / 0.91 |
| role:percussion hit | 0.97 / 0.91 | 0.97 / 0.90 |
| role:shaker | 0.89 / 1.00 | 1.00 / 1.00 |
| role:snare | 0.97 / 0.88 | 0.97 / 0.84 |
| role:synth hit | 0.68 / 0.78 | 0.69 / 0.94 |
| role:tambourine | 1.00 / 0.74 | 1.00 / 0.65 |
| role:vinyl scratch | 1.00 / 0.83 | 0.96 / 0.93 |
| role:vocal one-shot | — / 0.00 | 0.89 / 0.02 |
| role:whoosh | 1.00 / 0.78 | 1.00 / 0.76 |
| source:bass guitar | 1.00 / 0.50 | — / 0.00 |
| source:brass | — / 0.00 | 0.88 / 0.85 |
| source:drums | 0.98 / 0.57 | 0.95 / 0.39 |
| source:guitar | 0.70 / 0.70 | 0.76 / 0.49 |
| source:piano | 0.83 / 0.83 | 0.80 / 0.67 |
| source:synthesizer | 0.18 / 0.93 | 0.23 / 0.64 |
| source:voice | 0.99 / 0.64 | 0.96 / 0.64 |

## Caveats

- "Add only heads for categories the app currently abstains on" was decided **after** reading the full-retrain test result. All four new-coverage heads that passed development selection are added, including beatbox (P 1.00, R 0.06), so the choice is by rule, not per-category test performance. Confirmation on a fresh frozen set is still advisable.
- Distorted / reverberant test positives are NSynth quality tags; real-world mixes are not measured.
- Beatbox negatives in training are FSD50K clips (FSD50K has no beatboxing class); beatbox recall on AVP test participants is low (0.06).
- Scripts in `scripts/public-training/` use the absolute working paths of the run that produced these results.
