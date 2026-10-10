# Five tagger outputs promoted to full tags (2026-10-10)

The shipped tagger blend already scores these five outputs, but the app left them to other detectors (CLAP zero-shot fallback or a "maybe" CLAP head). On held-out FSD50K eval clips each one clears the 50/50 bar, so `taggerPolicy.json` now lets the tagger decide them.

| Tag | Output | Threshold | Held-out FSD50K eval (precision/recall, clips) | What decided it before |
|---|---|---|---|---|
| environmental sound | `cat:environmental sound` | 0.4549 | 0.85/0.73, n=290 | CLAP zero-shot, 0.37/0.32 |
| foley | `cat:foley` | 0.2941 | 0.71/0.63, n=763 | CLAP zero-shot, 0.65/0.31 |
| turntable | `cat:turntable` | 0.0124 | 0.73/0.84, n=38 | CLAP zero-shot, 0.97/0.46 |
| finger snap | `cat:finger snap` | 0.0331 | 0.60/0.62, n=29 | CLAP head (maybe), 0.82/0.46 |
| water ambience | `cat:water ambience` | 0.252 | 0.75/0.56, n=191 | CLAP head (maybe), 0.76/0.36 |

- Thresholds come from the published `thresholds.json` of the blended tagger. They were picked on FSD50K's validation split, not on eval.
- These outputs come from the runs 3/5 networks, which the runs 3+5+7+8 blend (#206) keeps unchanged, so the scores carry over.
- The held-out clips are 30 s or shorter. With no full-song evidence, long recordings defer to the existing detectors (`long: detectors`).
- `INSTRUMENT_ANALYSIS_REVISION` moves to 93/94 so tracks that were already analysed pick up the new tags.

Source: `reports/tagger-run7-results-2026-10-10.md` in the project files (the "shipped file" column).
