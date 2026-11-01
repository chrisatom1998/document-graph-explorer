# Fresh held-out test for "distorted" (round B), 2026-10-31

A new test set for the `distorted` tag, split by **physical guitar** and by **recording**, so the tagger is scored on a
guitar and songs it never heard in training. Nothing here is trained, tuned or calibrated on. The audio stays in the
private dataset `cmjatom/dge-private-train` (`guitarfx/v1`, written by `scripts/audio-model/stage-guitarfx.py`); this
folder holds only the rule and the group ids. `reserved-test-families.json` is read by every round A/B/C staging and
prepare script (`scripts/audio-model/round_abc.py`), and `distorted-heldout-2026-10-31` is in
`scripts/hf-sound-tags/config.json` `forbiddenSets`.

## What is held out

| Source | Held out | Why this split |
|---|---|---|
| IDMT-SMT-Audio-Effects (Zenodo 7544032) | every clip of **guitar 2** (instrument settings 8 and 9), mono and poly | the dataset records 2 guitars x 2 pickup settings; settings are the 2nd character of each file name (`G81-...` = setting 8) |
| Medley-solos-DB, test part only (Zenodo 3464194) | 46 song ids (list in the JSON): per instrument, songs sorted by `sha256('dge-distorted-heldout-2026-10-31\|<song_id>')`, taken until at least 30% of that instrument's clips and 2 songs | a song is one recording; all its clips stay together |

The held-out distorted-guitar songs are 025, 026 and 027 (312 of the 955 distorted-guitar clips). The other held-out
instruments (clarinet, female singer, flute, piano, tenor sax, trumpet, violin) give sure `distorted: absent` clips.

Never opened at all: IDMT `Bass monophon*.zip` (`idmt-bass` is a forbidden set) and Medley-solos-DB's training and
validation parts (cut from MedleyDB multitracks, which may share songs with the 417-song stem judge).

## eval-distorted

`prepare-staged.py` writes `eval-distorted` from held-out rows: up to 600 `distorted` present (IDMT guitar 2
Distortion + Medley held-out distorted-guitar songs) and up to 600 absent (guitar 2 clean / chorus / flanger / delay /
reverb / phaser / tremolo / vibrato and the held-out acoustic solos), 10 s padded, with `electric guitar` and `guitar`
labels where known. IDMT Overdrive clips are left out (overdrive = `saturated`, which leaves `distorted` unknown,
following EGFxSet). Only aggregate scores are reported; the per-clip ids stay in the private manifest.

## Known limits (please check)

- **Guitar mapping is assumed.** The dataset text says two guitars and two pickup settings; this split assumes
  settings 6-7 are guitar 1 and 8-9 guitar 2. If 6/8 and 7/9 are the same guitar, guitar 2 still shares no clip with
  training, but the "unseen guitar" claim weakens to "unseen pickup setting". Changing it means editing
  `idmtAudioEffectsHeldoutInstrumentSettings` before staging.
- **Medley-solos song ids are recordings, not players.** One player may appear in more than one song.
- **IDMT licence:** Zenodo lists CC BY-NC-ND 4.0 (the PDF says CC BY-SA). Weights trained on it stay non-commercial
  (CC BY-NC-SA, like the other non-commercial sources); the audio is never published.
