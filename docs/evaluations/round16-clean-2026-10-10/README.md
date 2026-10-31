# Round 16 detectors, retrained without FSD50K's test half (2026-10-10)

Five sounds passed round 16 (`rounds/round16.json` on Chris's Mac) but never shipped. Round 16 trained on
`fsd50k-all`, which includes FSD50K's **eval** split, and the scoreboard uses that split as a judge set. Chris chose
(decision card, 2:09 am PDT) to retrain without it before shipping.

How: `scripts/train-with-extras.py` with round 16's exact 13 extras, `BAR=0.45 EXPORT=0.5`, `ONLY=` the five sounds, and
`EXCLUDE=` a list of 4,972 clip ids whose Freesound id is an FSD50K eval clip (4,371 in fsd50k-all, 288 in fsm, plus
small overlaps in fsl10k, percussion, hip-hop, freesound-clean and processed). A first run without `EXCLUDE` reproduced
round 16's clip count (89,614) and scores, so the code and fingerprints match.

Held-out scores (whole uploaders held out, real recordings only; `report.json`):

| sound | precision | recall | test clips | was (round 16) |
|---|---|---|---|---|
| hand percussion | 0.98 | 0.80 | 149 | 0.98 / 0.80 |
| vocal shout | 0.96 | 0.70 | 110 | 0.92 / 0.59 |
| tuned percussion | 0.90 | 0.54 | 130 | 0.92 / 0.61 |
| breath | 0.82 | 0.51 | 113 | 0.85 / 0.51 |
| bell | 0.78 | 0.58 | 170 | 0.85 / 0.61 |

All five clear the 50/50 bar (`SOUND_TAG_BAR`), so they ship as normal heads in `public/sound-model/learned.json`.
None of the five had a tagger, calibration or blocked entry before.
