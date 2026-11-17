# Downlifter (tagger `cat:falling`) cutoff raised (2026-10-11)

The `cat:falling` tagger output (shown as "downlifter" since #229; weights unchanged, model 89288f0) now shows at
0.8101 instead of 0.5795.

Why: the output was trained mostly on falling *objects*, not DJ downlifters. On non-music FSD50K eval clips it fired on
glass shatters, coin drops and dropped dishes, and it found none of the labelled downlifters in the free-tag-set test.

| Fresh test set (strong labels plus known negatives) | Before (0.5795) | After (0.8101) |
|---|---|---|
| FSD50K eval, non-music clips (no downlifters) | 305 / 7,479 false alarms (4.1%) | 79 / 7,479 (1.1%) |
| Free-tag-set test downlifters found | 0 / 7 | 0 / 7 |
| NSynth test, SASS-E test false alarms | 0 | 0 |

- Fair check: clips split into two halves by uploader / pack / instrument. The cutoff was picked on one half (lowest
  cutoff with at most 1% false alarms) and judged on the other: FSD50K false alarms 4.1% -> 1.2%, recall unchanged.
- Handing the tag back to the CLAP detectors was measured too and is worse: on the same clips the app's CLAP side
  (learned heads plus prompts) flags 13.9% of non-music FSD50K clips as falling.
- Real downlifter recall stays at zero either way; that needs training data, not a cutoff.
- No re-analysis is needed: the policy cutoff applies at display time, so `INSTRUMENT_ANALYSIS_REVISION` stays.
