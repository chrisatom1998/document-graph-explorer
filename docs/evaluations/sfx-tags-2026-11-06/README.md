# Sound-effect tags from FSD50K (2026-11-06)

Five candidate tags (gunshot, vehicle, footsteps, thunder, phone ring) were built the same way as the acapella head (#297).
Gunshot and footsteps passed and ship. The other three did not.

## Recipe (fixed before any test clip was scored)
- **Fingerprints:** the app's own q8 CLAP window fingerprints (10 s windows, 5 s hop), made by `scripts/eval-tag.ts --score-only`.
- **Head:** logistic regression (C = 1, balanced classes) on the clip's mean unit window vector. The clip score is the
  highest window sigmoid.
- **Training clips:** FSD50K dev `train` split after the private exclude list. That is every positive, every clip of a
  confusable class, and 6,000 random others (11,951 clips).
- **Labels:**
  - gunshot = `Gunshot_and_gunfire`
  - vehicle = `Vehicle`
  - footsteps = `Walk_and_footsteps` (`Run` without it is skipped)
  - thunder = `Thunder` (`Thunderstorm` without it is skipped)
  - phone ring = `Telephone`
- **Cutoff:** the lowest value in 0.05..0.99 that reaches precision ≥ 0.65 with at least 3 hits on FSD50K dev `val`
  (2,144 clips, exclude list applied).
- **Judge:** run once, on all FSD50K eval clips (10,228 scored; no uploader overlap with dev) plus 4,096 NSynth test
  notes for false alarms. A tag passes at P ≥ 0.6, R ≥ 0.3 and NSynth false alarms ≤ 1%.

## Results (judge, scored once)
| tag | cutoff | P | R | tp / fp / pos | NSynth FA | result |
|---|---|---|---|---|---|---|
| gunshot | 0.78 | 0.684 | 0.903 | 121 / 56 / 134 | 2 / 4,096 | pass (60/60 too) |
| footsteps | 0.88 | 0.757 | 0.522 | 106 / 34 / 203 | 0 / 4,096 | pass |
| vehicle | 0.48 | 0.625 | 0.892 | 919 / 552 / 1,030 | 59 / 4,096 (1.4%) | fail: false alarms |
| thunder | 0.32 | 0.557 | 1.000 | 128 / 102 / 128 | 0 | fail: precision |
| phone ring | none | – | – | – | – | fail: no dev-val cutoff |

## Short clips (one-shots)
On clips of 2.25 s or less, the app keeps only learned heads marked `oneShot`. Without that flag, the app-path judge run
(`eval-tag --decide-only`) gave:
- gunshot: P 0.638 / R 0.552. All 51 short gunshot clips were missed.
- footsteps: P 0.786 / R 0.507.

Both heads therefore ship with `oneShot: true`. That choice was checked on dev val only, not on the judge set, through
the app path:

| head | without oneShot | with oneShot |
|---|---|---|
| gunshot | P 0.500 / R 0.419 (short R 0 of 18) | P 0.651 / R 0.903 (short R 0.83) |
| footsteps | P 0.680 / R 0.607 | P 0.679 / R 0.679 |

With the flag set, the app scores every clip the way the judge script did, so the judge numbers above are what the app
should show.
