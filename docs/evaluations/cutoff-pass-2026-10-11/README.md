# Percussion cutoff lowered (2026-10-11)

`cat:percussion` (run 7 network, unchanged weights) now shows at 0.249 instead of 0.457.

| Held-out set | Before (0.457) | After (0.249) | Positives |
|---|---|---|---|
| FSD50K eval | 0.87 / 0.55 | 0.80 / 0.68 | 343 |
| VCSL eval | 1.00 / 0.98 | 1.00 / 0.98 | 52 |
| Pooled | 0.89 / 0.61 | 0.83 / 0.72 | 395 |

- The cutoff was fitted only on validation clips the runs never trained on (FSD50K, NSynth and OpenMIC validation
  artists; 349 positives, 0.82 / 0.81 there), maximising min(precision, recall). Held-out sets were used only to check it.
- Long recordings already defer percussion to the other detectors (`long: { rule: 'detectors' }`), so full songs are unchanged.
- The same pass refitted every tagger output with one rule; that was net worse (50/50: 48 -> 45), so only this
  tag ships. Per-clip scores and scripts: private dataset `cmjatom/dge-eval-runs`, `runs/cutoffs-2026-10-11/`.
- No re-analysis is needed: saved analyses keep the raw tagger scores and `taggerDecisions()` applies the current
  policy cutoff when a track is shown, so `INSTRUMENT_ANALYSIS_REVISION` stays as it is.
