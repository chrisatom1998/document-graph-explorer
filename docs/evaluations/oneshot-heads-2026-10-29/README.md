# Five heads also run on short clips (2026-10-29)

On clips of 2.25 s or less the app switches off every learned head that is not marked `oneShot`
(`musicAnalysis.worker.ts`), and only the one-shot model (`short-clip.json`) decides. That model has no head for clave,
drum fill, spoken phrase, tom or vocal laugh, so on short clips these tags could never show. This change marks the five
heads `oneShot: true`. Weights and cutoffs are unchanged.

## How it was measured

App-path scoring that follows the summary's display rules (`confidentSoundSummary.ts`): a label with a tested detector
shows only from a trained head, never from raw CLAP similarity; other labels show raw CLAP only as an unverified tag on
clips longer than 2.25 s. CLAP fingerprints come from the app's own q8 transformers.js model (first 10 s). Judged on the
fresh test sets (FSD50K eval, NSynth test, SASS-E, IDMT bass, free-tag-set test half, Listen Check clips), every clip, with
the board's 60/30 rule: every set with 5+ positives needs precision >= 0.6 and recall >= 0.3, and false alarms stay at or
under 1% on sets with fewer than 5 positives and 50+ negatives. No cutoff is fitted on these clips; the only choice is the
on/off switch per head.

| Tag | Before (counted sets) | After (counted sets) | Worst false-alarm rate, other sets |
|---|---|---|---|
| clave | Listen Check 0 found of 5 | Listen Check 2 of 3 shown correct, 5 positives (P 0.67, R 0.40) | 0% |
| drum fill | free tag set 0 found of 7 | free tag set 6 of 6 correct, 7 positives (P 1.00, R 0.86) | 0.21% (FSD50K) |
| spoken phrase | FSD50K P 0.67, R 0.24 | FSD50K P 0.65, R 0.34 | 0% |
| tom | free tag set 0 found of 5 | free tag set 3 of 3 correct, 5 positives (P 1.00, R 0.60) | 0% |
| vocal laugh | FSD50K P 0.59, R 0.61; free tag set P 1.00, R 0.83 | FSD50K P 0.62, R 0.74; free tag set P 1.00, R 0.83 | 0% |

App-path 60/30 count: 64 -> 69 (no tag lost). Group-half check: spoken phrase and vocal laugh pass on both halves; clave,
drum fill and tom have their short-clip positives in one group half only, so they are confirmed on that half alone and
rest on few positives (5 to 7).
