# DJ effects round 2: grown clip set (2026-10-09)

Thread "More DJ effect clips". Branch `claude/dj-effect-clips-12lwv8`, workflow `.github/workflows/dj-effects-grow.yml`, Actions run 37872902885 (free GitHub runners, no Hugging Face spend).

## What changed in the data
- Same source and rules as PR #141: the pinned Freesound metadata dump (Chr0my/freesound.org, sha256 fdc81269…) and the tag rules in `scripts/dj-effects/labels.json`. Audio comes from public Freesound previews, and each clip keeps its own CC licence.
- All 4,770 round-1 clips are kept. The caps were raised to 1,200 clips per effect and 12 per uploader, with 4,800 plain negatives. That gives 16,049 clips with audio: 12,816 for training and 3,233 held out.
- The split is still by uploader, using the same hash rule, so no held-out uploader is trained on. `scripts/dj-effects/grow.py` asserts this.
- Ceiling: the dump simply has few tagged clips for riser (575 in all), noise sweep (226), filter sweep (182), reverse cymbal (117) and air horn (49). Most of the growth went to impact, whoosh, laser, siren and glitch.

## How it was judged
- New heads were fitted on the training split only, and the thresholds were chosen on out-of-fold training scores (unchanged `train.py`).
- The ship decision uses the same 1,193 round-1 held-out clips that #141 used, so before/after is one to one. "All held-out" adds the 2,040 new held-out clips, and a replacement must win there too.
- Ship rule (`ship.py`): a head replaces the current one only if it is better on min(P, R), then F1. A full (70/70) head is only replaced by another 70/70 head.

## Per effect (precision / recall)
| Effect | Train clips (was → now) | Current head P / R | New head P / R | All 3,233 held-out: current → new | Shipped |
|---|---|---|---|---|---|
| chops | 106 → 146 | 0.25 / 0.08 (maybe) | 0.18 / 0.28 | 0.10 / 0.08 → 0.10 / 0.27 | no |
| vocal chops | 46 → 63 | 0.45 / 0.82 (maybe) | 0.38 / 0.45 | 0.23 / 0.79 → 0.23 / 0.43 | no |
| stutter effect | 65 → 91 | 0.00 / 0.00 (maybe) | 0.21 / 0.30 | 0.00 / 0.00 → 0.15 / 0.32 | no |
| glitch effect | 336 → 1017 | – | 0.37 / 0.49 | – → 0.45 / 0.49 | no |
| reverse effect | 256 → 548 | 0.49 / 0.55 (maybe) | 0.60 / 0.56 | 0.45 / 0.58 → 0.54 / 0.58 | yes, maybe |
| vinyl scratch | 155 → 216 | 0.74 / 0.77 (full) | 0.82 / 0.65 | 0.51 / 0.78 → 0.65 / 0.66 | no |
| riser | 236 → 337 | 0.61 / 0.73 (maybe) | 0.68 / 0.69 | 0.42 / 0.69 → 0.51 / 0.64 | yes, maybe |
| downlifter | 13 → 20 | – | 0.00 / 0.00 | – → 0.00 / 0.00 | no |
| impact | 250 → 863 | 0.62 / 0.67 (maybe) | 0.63 / 0.72 | 0.67 / 0.68 → 0.71 / 0.74 | yes, maybe |
| whoosh | 287 → 952 | 0.85 / 0.54 (full) | 0.64 / 0.79 | 0.88 / 0.52 → 0.67 / 0.75 | no |
| reverse cymbal | 39 → 51 | 0.69 / 0.85 (maybe) | 0.73 / 0.62 | 0.61 / 0.85 → 0.67 / 0.62 | no |
| noise sweep | 126 → 154 | 0.48 / 0.62 (maybe) | 0.65 / 0.46 | 0.27 / 0.61 → 0.39 / 0.46 | no |
| sub drop | 29 → 43 | – | 0.50 / 0.25 | – → 0.38 / 0.22 | no |
| laser | 194 → 781 | 0.58 / 0.47 (maybe) | 0.51 / 0.53 | 0.70 / 0.51 → 0.65 / 0.60 | yes, maybe |
| siren | 217 → 893 | 0.70 / 0.74 (full) | 0.59 / 0.77 | 0.75 / 0.71 → 0.70 / 0.76 | no |
| air horn | 29 → 30 | 0.79 / 0.65 (maybe) | 0.92 / 0.65 | 0.52 / 0.65 → 0.73 / 0.65 | yes, maybe |
| flanged | 182 → 219 | – | 0.36 / 0.35 | – → 0.30 / 0.43 | no |
| bitcrushed | 124 → 180 | – | 0.38 / 0.27 | – → 0.20 / 0.23 | no |
| filter sweep | 77 → 87 | 0.55 / 0.48 (maybe) | 0.62 / 0.39 | 0.30 / 0.44 → 0.38 / 0.37 | no |
| trance gate | 66 → 82 | – | 0.31 / 0.28 | – → 0.23 / 0.27 | no |

## Result
- No effect newly reaches 70/70 on the round-1 held-out clips. Vinyl scratch and siren keep their current heads, because the retrained ones fall below 70/70 there.
- Five "maybe" heads were replaced by better ones: reverse effect, riser, impact, laser and air horn. Impact reaches 70/70 on all 3,233 held-out clips (0.71 / 0.74, 371 positives) but is just short on the round-1 clips (0.63 / 0.72), so it stays "maybe". Air horn gained almost no data (29 → 30), so its gain is threshold noise on 17 positives.
- Impact and laser stay cleared for one-shots (≤ 2.25 s): impact P .59 R .89 on 27 positives, laser P .67 R .65 on 31 positives.
- On the wider held-out set, the current vinyl scratch head is only 0.51 / 0.78. Its round-1 pass looks partly lucky.
- Takeaway: tripling impact, whoosh, laser and siren data moved them only a few points. With this encoder and uploader-tag labels, more Freesound tag data is close to its limit. Further gains need cleaner labels (hand-checked clips) or a model that sees time structure (risers and sweeps), not more tagged clips.
