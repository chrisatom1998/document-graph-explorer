# Free CLAP-head retrains, 2026-10-31 (vocal chops, breakbeat, filter sweep, foghorn bass)

**Result: no head changes.** None of the retrained heads beat the head that already ships, on the same held-out test clips. `public/sound-model/learned.json` is untouched.

How it was run:
- Run on the box at no cost. Same recipe as `train-with-extras.py` with the cleaned extras manifests, plus new staged clips that were used for training only.
- The test clips are chosen the same way every round (the brand hash in `held_out()`), so they are identical across all runs below. None of the new clips can reach a test, and the script checks this.
- "Precision" means: when the head says yes, how often it is right. "Recall" means: of the real cases, how many it finds. The bar to ship is both at least 0.50 on held-out real clips.

## Scores on the same held-out clips

| tag | run | right yes | false yes | missed | precision | recall | training positives |
|---|---|---|---|---|---|---|---|
| vocal chops | head shipping today | 71 | 42 | 7 | 0.628 | 0.910 | - |
| vocal chops | retrain, no new clips | 61 | 36 | 17 | 0.629 | 0.782 | 134 |
| vocal chops | + Looperman 106 + BSD 20 | 63 | 44 | 15 | 0.589 | 0.808 | 260 |
| vocal chops | + BSD 20 + 640 VocalSet/VocalSound hard negatives | 62 | 46 | 16 | 0.574 | 0.795 | 154 |
| vocal chops | + all three | 60 | 36 | 18 | 0.625 | 0.769 | 260 |
| breakbeat | head shipping today | 58 | 23 | 46 | 0.716 | 0.558 | - |
| breakbeat | retrain, no new clips | 32 | 8 | 72 | 0.800 | 0.308 | 1024 |
| breakbeat | + Looperman 206 + BSD 146 + Freesound 73 | 35 | 10 | 69 | 0.778 | 0.337 | 1449 |
| breakbeat | + BSD 146 + Freesound 73 (open licences only) | 31 | 14 | 73 | 0.689 | 0.298 | 1243 |
| breakbeat | + all, with a strength grid of 0.25 to 4 (it picked 1) | 35 | 10 | 69 | 0.778 | 0.337 | 1449 |
| foghorn bass | head shipping today | 8 | 41 | 8 | 0.163 | 0.500 | - |
| foghorn bass | retrain, no new clips | 5 | 18 | 11 | 0.217 | 0.312 | 52 |

The tests:
- vocal chops: 78 positives from held-out library brands;
- breakbeat: 104 positives from held-out library brands;
- foghorn bass: 16 positives from held-out real recordings.

The shipping-head rows score the weights on `main` against exactly the same test clips.

## What this means, tag by tag

**Vocal chops**
- Today's head already passes 50/50 and 60/60 on this test, at 0.63 / 0.91.
- Every retrain finds fewer of the real chops, so shipping one would be a regression.
- The new Looperman and BSD positives add little. The 20 BSD clips come from 1–2 uploaders and are mostly spoken phrases.

**Breakbeat**
- Today's head passes 50/50 at 0.72 / 0.56.
- Retrains stay precise (0.69 to 0.80) but find only about a third of the breaks.
- 425 extra positives moved recall by about 3 points. The gap is not the amount of data.

**Filter sweep**
- Not retrained. After removing everything on the test, judge, reserved and drop lists, Freesound has only 1 new open-licence clip tagged as a filter sweep.
- The 2026-10-09 round added 10 clips, and recall went down (0.48 to 0.39).
- It needs new labelled clips from a different source.

**Foghorn bass: blocked by the labels, not by missing data**
- The catalog means a big synth/bass blast, the "inception horn" kind of sound.
- About half of the 16 test positives are field recordings of harbours and ships. That count is by title, not by listening.
- 2 more of them are acoustic horns (air horn, medieval horn).
- 4 recordings from the same "foghorn far" series as two of the positives are labelled negative.
- The staged VGGSound "foghorn" class (167 clips) does not fit either. A listening model (CED, AudioSet classes) puts "Music" in the top 3 for 127 of them, "Speech" for 41, and "Ship" or "Boat" for about 30. Only 8 clips score above 0.3 for Foghorn, and 1 for Synthesizer.
- Adding them would teach the head ship horns. So they were not used, as positives or as negatives.
- Next step: relabel the foghorn-bass training and test clips to the catalog's meaning, or rename the tag.

## Training-only clips added (none reach any test)

| set | tag | role | clips | licence |
|---|---|---|---|---|
| Looperman (round13 staged) | vocal chops | positive | 106 | Looperman terms (royalty-free use, no redistribution) |
| BSD (datasets-v1 staged) | vocal chops | positive | 20 | CC0 |
| VocalSet | vocal chops | hard negative | 240 | CC BY 4.0 |
| VocalSound | vocal chops | hard negative | 400 | CC BY-SA 4.0 |
| Looperman (round13 staged) | breakbeat | positive | 206 | Looperman terms |
| BSD (datasets-v1 staged) | breakbeat | positive | 146 | CC BY 4.0 116, CC0 29, CC BY 3.0 1 |
| Freesound, matched by text | breakbeat | positive | 73 | CC0 35, CC BY 4.0 23, CC BY 3.0 15 |

Notes on the added clips:
- Hard negatives are capped at 12 per singer or speaker, chosen with seed 20261031. They carry only the label `voice`, so they count as "not a vocal chop".
- No NC audio is used, so the licence of the weights would not change.

Clips removed before training:
- every Freesound id or uploader that is in a reserved-test-families file, the FSD50K eval set, the FSD50K dev-val uploaders, the judge-set uploaders, the freesound test half, the held-out staging ids, or the r20 drop list;
- clips whose CLAP fingerprint is a near copy (cosine 0.98 or more) of any clip already in the library or the extras: 14 dropped.

Audio, test ids and the per-clip list stay private.

The AudioSet clips that are staged are all vocal one-shots, such as laughs, shouts and breaths. They were not needed, because VocalSet and VocalSound cover the vocal hard negatives.
