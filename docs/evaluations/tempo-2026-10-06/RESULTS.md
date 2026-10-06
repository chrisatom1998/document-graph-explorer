# Tempo correction: half time and triplet feel (2026-10-06)

The 500-clip DJ check (`../dj-clips-2026-10-06/RESULTS.md`) found that the app's tempo was within 4% of the labelled
BPM on only 53.6% of Beatport EDM clips. Most misses were the beat tracker locking onto half time (drum & bass at 87
instead of 174) or two-thirds time (93 for a 140 track). The tempo's confidence did not separate right from wrong.

## The change

`estimateTempo` (recordings of 8 s or more) still runs Essentia's beat tracker. It then re-checks the tracker's BPM
against six alternatives: ×2, ×½, ×3/2, ×2/3, ×4/3 and ×3/4, limited to 60–200 BPM. Each candidate is scored by small
gradient-boosted trees (`src/audio/tempoCorrection.json`). The inputs are the onset tempogram's strength at the
candidate and at nine related tempos, plus a mild preference for tempos near 120. The app switches only when an
alternative beats the tracker's own tempo by 0.3 in probability. Clips shorter than 8 s are unchanged. The analysis
revision is bumped, so existing audio is re-analysed for tempo.

## How it was tuned without touching the test

| Set | What | Used for |
|---|---|---|
| `tune` | 161 GiantSteps tracks **not** in the 500-clip test (three cuts each), plus a hashed half of GTZAN (500 tracks, 10 s and full 30 s) | Choosing features, model and margin with 5-fold cross-validation grouped by track |
| `gtzan-test` | The other half of GTZAN (blues, classical, country, disco, hip-hop, jazz, metal, pop, reggae, rock) | One check that non-dance music is not hurt |
| `holdout` | The exact 500 frozen DJ clips | One check after the rule was frozen |

The held-out sets were opened once, after the rule was frozen. Features come from `.github/workflows/tempo-features.yml`
(`features/*.json.gz`). `python3 scripts/tempo/train.py docs/evaluations/tempo-2026-10-06/features --write --heldout`
rebuilds the identical model and prints `train-output.txt`.

## Results (within 4% of the labelled BPM, app tempo before and after)

| Set | Clips | Before | After | Fixed | Broken |
|---|---|---|---|---|---|
| **500 DJ clips (held out)** | 500 | 53.6% | **71.4%** | 94 | 5 |
| drum & bass | 104 | 17% | 59% | 45 | 2 |
| breaks | 18 | 44% | 78% | 6 | 0 |
| trance | 55 | 65% | 78% | 7 | 0 |
| techno | 43 | 72% | 81% | 4 | 0 |
| dubstep | 57 | 56% | 65% | 7 | 2 |
| GTZAN other genres (held out) | 894 | 73.6% | 73.4% | 15 | 17 |
| tune, GiantSteps (cross-validated) | 462 | 54.5% | 76.6% | 103 | 1 |
| tune, GTZAN (cross-validated) | 907 | 74.4% | 74.6% | 17 | 15 |

On the 500 DJ clips, the score allowing half or double tempo rises from 73.8% to 85.4%. A listener's T1-or-T2 tempo
rises from 75.6% to 86.8%. On non-dance music the change is close to neutral. Hip-hop, metal and reggae improve
slightly. Pop drops from 86% to 79% (6 of 97 clips broken), and rock and country lose 2–4 clips each.

**Confirmed in the real app.** `dj-clips-eval.yml` re-ran all 500 clips through the built app in headless Chromium
at 4739461 (run 37407942029, `../dj-clips-2026-10-06/results-tempo-fix/`). Tempo was within 4% on **71.6%**
(53.6% before), and 85.4% allowing half or double tempo. Drum & bass reached 60%. Sound tags on both sets were identical
to the baseline run.
