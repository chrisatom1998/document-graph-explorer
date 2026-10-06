# Dubstep and electro house showed no sound tags (2026-10-05)

## Why
The Sounds panel only shows detectors that passed a held-out test (OpenMIC fusion heads, CLAP trained heads). On the
frozen SoundCloud clips (`scripts/online-dj/soundcloud-clips.json` on branch `claude/project-thread-rjgnlw`), those stay
low on the dubstep and electro house mixes, while the music-trained Jamendo model is confident but untested, so hidden:

| Clip | Fusion synth / drums | CLAP head synth / drums (threshold 0.66 / 0.51) | Jamendo synth / drum kit |
|---|---|---|---|
| sc-04 dubstep | 0.15 / 0.21 | 0.43 / 0.10 | 0.48 / below 0.30 |
| sc-07 electro house | 0.06 / 0.06 | 0.65 / 0.09 | 0.78 / 0.61 |

## Change
Jamendo synthesizer and drum-kit / drum-machine window scores at or above **0.40** count as tested on recordings of at
least 10 s (`FULL_MIX_JAMENDO` in `src/audio/confidentSoundSummary.ts`). Presentation only.

## How the threshold was set
`openmic-main.json`: the 900 frozen OpenMIC-2018 test clips of `docs/evaluations/mixed-music-2026-10-05`, analysed by
the current main build in headless Chromium (one record per clip, written by `scripts/full-mix/extract.mjs`).
`scripts/calibrate-full-mix-jamendo.py` splits clips by artist hash, picks the lowest threshold from the 0.40 display
floor whose calibration precision (rule alone) is at least 0.70, and reports the held-out half untouched
(`calibration.json`). OpenMIC is easy for main because its fusion heads were fitted on OpenMIC's train partition, so the
rule is judged on its own.

| Label | Half | Positives / negatives | Main P / R | Rule alone P / R | Main + rule P / R |
|---|---|---|---|---|---|
| synthesizer | calibration | 24 / 12 | 0.96 / 0.96 | 1.00 / 0.88 | 0.96 / 1.00 |
| synthesizer | held-out | 37 / 8 | 0.97 / 0.92 | 0.97 / 0.78 | 0.97 / 0.92 |
| drums | calibration | 29 / 14 | 0.87 / 0.93 | 0.91 / 0.72 | 0.85 / 0.97 |
| drums | held-out | 27 / 8 | 0.90 / 1.00 | 1.00 / 0.70 | 0.90 / 1.00 |

Across all 900 clips the rule adds synthesizer to 47 and drums to 51; clips with no tag go from 12 to 5. Explicit
negatives are few, so precision intervals are wide.

## SoundCloud before / after (same 15 clips, real app)
`soundcloud-main.json` and `soundcloud-branch.json`: main vs this branch. 26 → 32 tags; nothing removed.

| Clip | Added |
|---|---|
| sc-04 dubstep | synthesizer (possible, 0.48) |
| sc-07 electro house | synthesizer (likely, 0.78), drums (likely, 0.61) |
| sc-03 liquid drum & bass | synthesizer (possible, 0.48) |
| sc-12 trap | synthesizer (possible, 0.48) |
| sc-15 progressive house | synthesizer (likely, 0.81) |

Truth for these clips is inferred from genre and uploader tags (nobody listened): the dubstep, electro, drum & bass and
progressive house additions are expected; trap (a marimba beat) is doubtful. Dubstep drums are still missed.
