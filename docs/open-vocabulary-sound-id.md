# Open-vocabulary sound ID: coverage push (2026-10-05)

Branch `open-vocab-all-labels`. This note follows `dge-open-vocabulary-sound-id-instructions.md`. Raw numbers are in
`docs/evaluations/open-vocab-2026-10-05/`. `scorecard.json` lists every label; `round16-results.json` holds the
held-out measurements.

## Result

**72 of the 198 catalog labels can now appear as Sounds tags, up from 51.** A label is "active" when a trained head
ships in `learned.json` or `short-clip.json`. All 21 new labels come from this branch. Another session swapped
the existing distorted head for a different version and promoted five existing heads to full tags.

| Bucket (45/45 bar, measured on held-out sources) | Labels |
|---|---|
| Active, full tag (precision and recall ≥ 0.60) | 41 |
| Active, "maybe" tag (0.45–0.60) | 31 |
| Near: one of precision/recall ≥ 0.45 | 51 |
| Failing: both < 0.45 | 32 |
| Untestable: under 15 held-out positives | 15 |
| Measured on made-up clips only (not shipped) | 4 |
| Owned by the other session (not shipped here) | 24 |

All 198 labels can be displayed: a unit test checks that each catalog label shows once a head reports it.
Labels with no head simply never fire.

New active labels on this branch (★ = full): acoustic guitar★, saxophone★, whisper★, snare roll★, ukulele★,
kalimba★, jaw harp★, singing bowl★, synthesizer, clarinet, vocal chops, chops, vocal phrase, vocal breath,
synth sequence, foghorn bass, riser, stutter effect, texture, bird ambience, triangle.

## Pass bar: conflicting rulings

The user told this session **45/45**. Another session relayed **60/60** from the same night. Both are honoured with
two tiers. Heads at 60/60 or better ship as full tags. Heads between 45 and 60 ship with `maybe: true`, so the panel
shows them faded with "maybe". **The user should confirm which bar they want.** If it's 60/60, remove the heads with `maybe: true`
from `learned.json` and re-pin its hash in `manifest.json` (as in commit c91a8c7). `add-maybe-heads.py` only adds heads.

## What was built

1. **Tiers for long recordings (Step 7).** Constants live in `confidentSoundSummary.ts`: `TRACK_SOUND_FLOOR = 0.40`
   and `LIKELY_SOUND_CUTOFF = 0.50`. Recordings over 2.25 s show 0.40–0.49 as "possible" (dashed tag; hover text
   says "not calibrated, not a 40% chance"). Scores of 0.50 and up show as "likely". One-shots keep the 0.50 floor.
   Tests cover 0.39 (hidden), 0.40 (possible) and 0.50 (likely). The summary is presentation only, so possible tags
   never create graph links.
   - **Known gap:** trained heads only report a score once it clears their own threshold, which is 0.50 or higher.
     So "possible" appears only for the fusion detector's decisions, not for head tags. Calibrated probabilities
     (Platt or isotonic) need a hand-checked full-track test set, which does not exist yet.
2. **Tag-mined Freesound audio.**
   - `freesound-mine-manifest.py` picks clips from the public metadata dump (554,850 sounds). It takes at most
     120–150 clips per label and 4 per uploader, and skips every reserved test id and uploader. Extra search words
     are in `freesound-extra-terms.json`.
   - `fetch-freesound-previews.mjs` downloads the first ~15 s of each public preview (no API token) and records the
     clip's own licence.
   - `freesound-mined-merge.py` merges both passes into one row per sound.
   - Result: 12,684 clips for 140+ labels. Licences: CC0 6,036; CC-BY 4,635; CC-BY-NC 1,771; Sampling+ 238; other 4.
     Non-commercial clips are allowed because the app is not commercial.
   - Labels come from uploader tags, so they are noisy. A missing tag counts as unknown, not as absent.
3. **Synth types from Surge preset names** (`surge-name-manifest.py`): FM, acid, organ, string, brass, vocal-like,
   supersaw, rubbery, bass pluck, stab and bell. These are merged into the Surge rows, so no clip appears twice with
   disagreeing labels.
4. **Character renders** (`build-character-renders.py`): chorus, flanger, bitcrush, saturation, wobble, swell,
   pulse, glide, rise, fall, bright and dark on Surge, Slakh and WaivOps sources. Dry versions are kept and
   loudness is matched.
5. **Trainer changes** (`train-with-extras.py`):
   - The bar is configurable.
   - Reserved test recordings and families are dropped automatically.
   - Character labels get their own jobs, and near-synonym words (saturated/distorted, chorus/flanger…) are never
     negatives for each other.
   - **Labels without a library test are tested on held-out real recordings first.** These are FSD50K, FSL10K,
     mined Freesound, Epidemic and hip-hop one-shots. Renders are used for training only.
6. **Real-upload check** (`ui-upload-check.mjs`, `ui-export-tags.mjs`): uploads files into the built app in headless
   Chromium, then reads the Sounds panel and the app's own export.

## Upload check in the real app (build with 65 learned heads)

| File | Shown |
|---|---|
| Electro track, 3:46 | 120.1 BPM, A minor; piano, voice, sound effect, texture (all maybe). Screenshot: `upload-electro-track.png` |
| House track, 5:21 | 126 BPM; drums, drum loop, synthesizer (maybe), sound effect (maybe). Analysis "partial" (machine at load ~400) |
| 0.36 s kick one-shot (the source clip's length) | kick, drums, impact |
| 5 s silence | nothing |
| Random-bytes .wav | not added to the graph; no page errors |

## Rejected experiments

- **Round 15 (renders tested on renders):** the character heads looked strong (bitcrushed 1.00/0.85). Another
  session showed that render-trained effect heads fail on real recordings (reverberant 8%/3%). Those heads were
  withdrawn, and the test pool was switched to real recordings.
- **Round-14 edited-clip heads** (record stop, sub drop, reverse impact/cymbal, pitched/reversed vocal,
  vinyl crackle): they passed held-out synthetic edits but failed on real library files (e.g. sub drop found
  0 of 36). Removed. These labels belong to the other session.
- **Round 17 (thresholds picked on real training rows only):** 12 labels better, 22 worse, same 78 passing.
  Rejected. This change was chosen after seeing round 16, so its numbers are not clean.
- **Smaller test minimum (10) for banjo, cajon, mandolin, oboe, air horn, vocal shush, woodblock, organ synth,
  vocal harmony:** none passed.
- **A "precise but rarely fires" tier** (e.g. electric piano 0.88/0.44, clave 1.00/0.37 on 7 hits) was considered
  and not shipped. It would change what "maybe" means and lower the bar.

## Known gaps and next steps

- **Near labels usually have high precision and low recall.** Their thresholds are 0.92–0.99 because they are picked
  on training rows the head separates easily. More real positives per label is the fix, not a lower threshold.
  Best candidates:

  | Label | Precision / recall | Test positives |
  |---|---|---|
  | spoken phrase | 1.00 / 0.44 | 34 |
  | 808 bass | 0.88 / 0.43 | 108 |
  | electric piano | 0.88 / 0.44 | 32 |
  | marimba | 0.76 / 0.43 | 30 |
  | double bass | 0.78 / 0.41 | 17 |
  | horn | 0.88 / 0.39 | 57 |
  | reese bass | 0.81 / 0.38 | 103 |
  | plucked | 0.79 / 0.38 | 39 |

- **Failing labels are mostly character words and synth subtypes.** Examples: bright, warm, metallic, airy, nasal,
  sustained, syncopated, saturated, fm synth, synth stab, synth chord. Uploader tags for these words are unreliable,
  and CLAP fingerprints don't separate synth subtypes. Next steps: signal-processing detectors (spectral centroid
  for bright/dark, envelope for percussive/sustained, onset statistics for syncopated) and a hand-checked set.
- **Untestable (15 labels)** need real clips from more uploaders: vocal harmony, organ synth, rubbery bass,
  woodblock, shaker loop, air horn, oboe, banjo, mandolin, steel guitar, steel drum, cajon, waterphone, vocal shush,
  synth hit.
- **Made-up only (4 labels):** bell synth, brass synth, string synth and bass pluck have no real test clips.
- **For the other session:** on held-out real recordings, several of its labels already pass 45/45:
  - hand percussion 0.98/0.80
  - turntable 0.98/0.62
  - tuned percussion 0.92/0.61
  - vocal shout 0.92/0.59
  - bell 0.85/0.61
  - breath 0.85/0.51
  - environmental sound 0.75/0.54
  - animal sound 0.71/0.55

  The round-16 export in `~/Documents/Media/dj-training-fingerprints/rounds/round16.json` holds their weights.
- Per-label baseline numbers (before this branch) are in `~/Documents/Media/dj-training-fingerprints/rounds/round13-export.json`.
- The held-out groups are re-drawn each round, so these are development numbers, not frozen-test numbers. A new,
  dated, frozen, hand-checked test set (one-shots, loops and a few full tracks with time ranges) is still the main
  missing asset.

## Licences

- Models are unchanged: CLAP, AST, and the MTG-Jamendo model (non-commercial, allowed because the app is not
  commercial).
- The shipped heads are weight vectors trained partly on CC-BY and CC-BY-NC Freesound clips. The audio itself is
  never redistributed. Per-clip licence and author are stored in `fsm-clap/manifest.json`.
