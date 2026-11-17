# Trumpet cutoff raised (2026-10-11)

The `trumpet` tagger output (weights unchanged, model 89288f0) now shows at 0.9486 instead of 0.6648.

| Fresh test set | Before (0.6648) | After (0.9486) | Positives |
|---|---|---|---|
| FSD50K eval | 0.26 / 0.82 | 0.80 / 0.50 | 56 |
| Free-tag-set test (weak labels, precision is a lower bound) | 0.42 / 0.95 | 1.00 / 0.86 | 22 |

- Precision first (ship line 60/30): the cutoff was picked on a calibration half only. Calibration = the
  reserved Freesound clips (not on the board) plus one half of each board set, split by uploader / pack so no
  source straddles both halves. It is the lowest cutoff that keeps precision at or above 0.65 on every
  calibration set. On the untouched judge half of FSD50K: 0.33 / 0.81 -> 0.83 / 0.54 (37 positives).
- The full-set numbers above include the calibration half, so they are slightly optimistic; the judge-half numbers
  are the clean check.
- Same pass also tried signal rules (loudness shape, low-band energy, flatness, onsets, pitch glide) and rules that
  let related tagger outputs vote. For trumpet they did no better than the cutoff, so only the cutoff ships.
- No re-analysis is needed: `taggerDecisions()` applies the policy cutoff at display time, so
  `INSTRUMENT_ANALYSIS_REVISION` stays as it is.
