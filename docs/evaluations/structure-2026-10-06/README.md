# Track structure (intro, drops, breakdowns, outro), 2026-10-06

`src/audio/structure.ts` finds the drops in a full track from loudness, bass and kick energy per quarter second
(no model). Labels: [Raveform](https://mir-aidj.github.io/raveform/) (CC BY 4.0), 1,423 EDM tracks with
hand-labelled intro / buildup / breakdown / drop / cooldown / outro boundaries.

## Data

YouTube refuses GitHub Actions runners ("confirm you're not a bot"), so `.github/workflows/structure-eval.yml`
(`scripts/structure-fetch.py`) searched SoundCloud by title and kept only uploads within 2 s of the labelled
length: 287 of 600 tried. Later drops line up with the labels to within a block, so the uploads match the
labelled masters. `features/` holds the app's features (`scripts/structure-features.ts`) and the labels; no audio.
Genres: techno 52%, tech house 13%, drum & bass 8%, mainstage 7%, trance 6%, deep house 4%, others.

Split by Raveform's own folds: 0-3 tuned the settings (153 tracks), 4-7 were scored once at the end (134 tracks).

## Results (held-out folds 4-7, 134 tracks; `heldout.json`)

| | |
|---|---|
| First drop within 2 s of the label | 54.5% |
| within 4 s | 56.7% |
| No drop found | 3.0% |
| Median first-drop error | 0.4 s |
| All drop entries: precision / recall at 2 s | 69% / 71% |
| Quick scan's 10 s window inside a labelled drop: first drop | **76.9%** |
| ... the old middle-of-track window | 38.8% |

Tuning folds: 59.5% within 2 s, window in drop 71% vs 32% (`tune.json`).

When it misses, it is usually because a buildup (drums and bass already in, before a breakdown and the real
drop) was taken as the first drop: 46 of 153 tuning tracks before the 12% rule below, still the main error.

What changed while tuning: one threshold on whole-track intensity got 7.5% on the first 80 tracks (techno intros
already have full bass, so the "drop" started at 0:00); on folds 0-3, looking for steps up in intensity got 39-50%; dropping a
rise that a clearly higher one follows within 64 s, and not placing the first drop in the first 12% of the track
(5% of labelled first drops come earlier), got 59.5%.

## Cost

Features: about 67 ms of JavaScript per minute of audio (Node on an Actions runner). Decoding the whole track at
16 kHz with the app's FFmpeg WASM build, 60 s at a time: 1.4 s for a 5-minute 320 kbps MP3 (Node, same WASM).
So about 2 s more per 5-minute track; tracks under a minute are skipped.
