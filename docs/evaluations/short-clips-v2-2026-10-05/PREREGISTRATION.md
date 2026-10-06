# Pre-registration: short-clip test set v2

Written 2026-10-05, before any clip was listened to and before any model was scored on this set.

## Why a second set
The first frozen short-clip split (`short-clips-2026-10-04`) was used three times (baseline, after-v1, v2), and an
external 80-clip bass pack was read three times during the 2026-10-05 short-clip work. Neither can give a fair number
for the bass-hit head shipped in PR #108 or for anything after it.

## What is being measured
- Primary: `role:bass hit` precision and recall of what DGE displays for clips of 0.15–2.25 s, with
  family-bootstrap 95% intervals (`scripts/short-clip-report.py`).
- Secondary: the other ten question-set labels (kick, snare, clap, hi-hat, synth hit, impact, whoosh, vinyl scratch,
  beatbox, voice), same method.
- The one-shot heads only (`public/sound-model/short-clip.json`). Looped heads are hidden on these clips by the app.

## Where the clips come from
Pools no one-shot head trained on, filtered to families (Freesound uploader or sample pack) absent from both the
one-shot training items and the first test set's reserve: `dj-training-sounds`, `freesound-mined-*`, Producer Space
CC0. Licences: CC0, CC BY, CC Sampling+ only; evaluation use, audio not redistributed. Folder, tag and file names
are **selection hints only**; the looped `learned.json` heads were trained on some of these Freesound pools, which
is why this set measures one-shot heads only.

## How labels are made
Blind listening in Sound Label Studio (`scripts/build-short-clip-test-v2.py select`, served with
`DJ_REVIEW_NO_APPLY=1`): opaque clip names, no hints, fixed shuffled order. The listener judges the eleven question
labels on every clip. On a confirmed clip, a question label not marked present is **absent**; "unsure" is unknown;
labels outside the question set are unknown unless marked present. Vocal drum imitations (Producer Space
"Vocal Percussion FX") keep kick, snare, hi-hat and clap unknown by design, as the first set did for AVP.
Clips the listener did not confirm are left out of the frozen set.

## Rules
1. `freeze` runs once; the manifest SHA-256 is recorded in `summary.json` and the script refuses to overwrite it.
2. First read: the shipped `short-clip.json` on `main` at freeze time, through the real upload path
   (`MANIFEST=… AUDIO_DIR=… node scripts/short-clip-upload-eval.mjs`, then `short-clip-displayed`, then
   `short-clip-report.py`). That result is reported as-is.
3. No threshold, head or feature is tuned on this set. Every later read is logged below with the model revision and
   is reported as a later read, never swapped in for the first.
4. Reserved families (`reserved-test-families.json`) are excluded from all future training and calibration.

## Reads
(none yet)

## Protocol note (2026-10-05, before freeze, after 16 clips)
At the listener's request the eleven toggles are now pre-ticked from the clip's selection hint (folder or uploader
tag), via `scripts/short-clip-review-server.py`. The hint is never a detector under test. The listener clears wrong
guesses and adds missed sounds before confirming. Each confirmed clip records `labelMode: blind` (the first 16) or
`hint-assisted`, with the guesses kept and cleared; the report will state both counts. Expected effect: agreement with
hints is inflated for assisted clips, so a hint-assisted bass-hit "present" is weaker evidence than a blind one.

## Protocol note (2026-10-05, before freeze, after 27 clips)
Review order changed so the unconfirmed bass-hint clips come first, then drum hints (the hardest bass negatives), then
synth stabs, effects, vocals and the rest. Clip membership, audio and ids are unchanged. Consequence: a partial freeze
is enriched for bass and drums, so its precision/recall are stated for that enriched mix, not for a random sample.
