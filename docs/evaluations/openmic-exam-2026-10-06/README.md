# OpenMIC song exam (2026-10-06)

The 2026-10-03 pilot has 24 locked test clips with 21 heard instruments, so one clip moves recall by about five
points. This exam is about seven times bigger and keeps practice and test apart by artist **and** album.

| Split | Clips | Artists | Labelled answers (present / absent) | Use |
|---|---|---|---|---|
| train (practice) | 200 | 168 | 151 / 275 | ideas may be tuned here |
| test (locked) | 169 | 52 | 135 / 202 | checked once per change, never tuned on |

- Built by `scripts/build-openmic-exam.py` from the official OpenMIC-2018 archive (MD5 `e4ccf187…`), with the
  pilot's rights rule (CC BY / CC0 only), annotation policy and identity-only hash ranking, plus a new seed.
  Every pilot clip, artist, album and recording is excluded, so the pilot stays a separate check.
- Only about 120 official-test artists have CC BY / CC0 clips, so the test takes up to 10 recordings per artist
  (round-robin) and practice up to 4. Correlated clips are handled by the provenance-group bootstrap in
  `src/audio/evaluation.ts`. A bigger test would need NC-licensed clips, which the rights rule excludes today.
- Audio is not committed. Rebuild it (about 2 minutes) with
  `python3 scripts/build-openmic-exam.py <openmic-2018-v1.0.0.tgz> <out>`, which refuses to overwrite this freeze.
- Scoring: `npx vite-node scripts/score-openmic-exam.mjs <train|test> <name>=<graph-export.json>`. "Sounds panel" is
  what the app shows (`confidentSoundSummary`). Unlabelled clip/instrument pairs are never scored. The scorer lets
  each class match its own name ("cymbals", "bass", "mallet_percussion"), which is what the trained instrument
  detector shows; the pilot's older alias list missed those three.
- Runs: built app, headless Chromium, full analysis mode, `scripts/stitched-song-eval.mjs` (it uploads any list of
  WAVs). About 30 s per clip with two runs sharing a 4-core container.

## First results: today's app (main `dfacb71`)

| Sounds panel | Precision | Recall | TP / FP / FN | Precision 95% interval |
|---|---|---|---|---|
| Practice | 0.75 | 0.80 | 121 / 41 / 30 | 0.68–0.82 |
| Locked test | 0.74 | 0.87 | 118 / 41 / 17 | 0.68–0.81 |

Instruments meeting 70/70 on the test: 10 of 20.

## Change measured here: show the trained detector's yes/no decisions

For six instruments (accordion, guitar, piano, saxophone, trombone, violin) the trained instrument detector's own
head failed testing, so its tested policy falls back to a yes/no rule. A "yes" from that rule carries no score, and
the Sounds panel required a score of at least 0.40, so these tested decisions never showed. They now show as
"possible", with "Baseline fallback score: yes" in the hover text and never the failed head's number.

Chosen on practice only (decision record: two ideas were tried there; the other one, also showing trained-detector
"yes" decisions scored 0.37–0.40, added 1 correct answer for 6 false alarms, so it was dropped):

| Sounds panel | Before | After |
|---|---|---|
| Practice: precision / recall | 0.75 / 0.80 | 0.76 / 0.91 (137 / 44 / 14) |
| Locked test: precision / recall | 0.74 / 0.87 | 0.74 / 0.91 (123 / 44 / 12) |
| Locked test: instruments meeting 70/70 | 10 / 20 | 11 / 20 (saxophone joins; none lost) |
| 80 stitched long songs: recall (precision) | 0.67 (0.93) | 0.72 (0.93) |
| 80 stitched long songs: control songs with a false alarm | 21 / 40 | 23 / 40 |

Locked test per instrument, after the change (before in brackets where it changed):

| Instrument | Present / absent | Before P / R | After P / R | TP / FP / FN | 70/70 |
|---|---|---|---|---|---|
| accordion | 1 / 12 | — / 0.00 | — / 0.00 | 0 / 0 / 1 | no |
| banjo | 8 / 6 | 0.83 / 0.62 | 0.83 / 0.62 | 5 / 1 / 3 | no |
| bass | 3 / 10 | 0.43 / 1.00 | 0.43 / 1.00 | 3 / 4 / 0 | no |
| cello | 7 / 6 | 0.83 / 0.71 | 0.83 / 0.71 | 5 / 1 / 2 | yes |
| clarinet | 3 / 15 | 0.38 / 1.00 | 0.38 / 1.00 | 3 / 5 / 0 | no |
| cymbals | 14 / 5 | 0.93 / 1.00 | 0.93 / 1.00 | 14 / 1 / 0 | yes |
| drums | 6 / 8 | 0.86 / 1.00 | 0.86 / 1.00 | 6 / 1 / 0 | yes |
| flute | 4 / 10 | 0.57 / 1.00 | 0.57 / 1.00 | 4 / 3 / 0 | no |
| guitar | 8 / 3 | 1.00 / 0.75 | 0.88 / 0.88 | 7 / 1 / 1 | yes |
| mallet percussion | 8 / 12 | 0.80 / 1.00 | 0.80 / 1.00 | 8 / 2 / 0 | yes |
| mandolin | 14 / 16 | 0.67 / 1.00 | 0.67 / 1.00 | 14 / 7 / 0 | no |
| organ | 1 / 8 | 0.50 / 1.00 | 0.50 / 1.00 | 1 / 1 / 0 | no |
| piano | 14 / 3 | 1.00 / 1.00 | 1.00 / 1.00 | 14 / 0 / 0 | yes |
| saxophone | 8 / 11 | 1.00 / 0.38 | 0.78 / 0.88 | 7 / 2 / 1 | yes |
| synthesizer | 8 / 2 | 1.00 / 1.00 | 1.00 / 1.00 | 8 / 0 / 0 | yes |
| trombone | 1 / 24 | — / 0.00 | — / 0.00 | 0 / 0 / 1 | no |
| trumpet | 2 / 23 | 0.18 / 1.00 | 0.18 / 1.00 | 2 / 9 / 0 | no |
| ukulele | 15 / 16 | 0.74 / 0.93 | 0.74 / 0.93 | 14 / 5 / 1 | yes |
| violin | 7 / 10 | 1.00 / 0.71 | 1.00 / 0.71 | 5 / 0 / 2 | yes |
| voice | 3 / 2 | 0.75 / 1.00 | 0.75 / 1.00 | 3 / 1 / 0 | yes |

What still fails is mostly **precision**, not recall: trumpet (9 false alarms), clarinet (5), mandolin (7), bass (4).
Fixing those needs better per-instrument detectors, not display rules.

## Tested and not shipped: "two windows" on long songs

On 80 s stitched songs the panel names an absent instrument in about half the control songs. The suspected cause
was that one 10 s window is enough. Requiring the trained detector to fire in 2 windows (recordings with 3 or more
windows) removed only 1 of 23 such false alarms and cost 6 correct answers; 3 windows removed 5 and cost 20. The
false alarms are sustained (most fire in 3 to 10 windows at 0.6–0.97), so the window count is not the problem and
the rule was not shipped. Either the detector truly confuses these instruments or OpenMIC's crowd "absent" labels
are wrong on some clips; listening to a sample would tell which.

## Honest caveats
- 10 clips of an early test export were seen while debugging the analysis script, before any choice was made. The
  final change was chosen on practice data; the test was scored once for it (and once for the dropped combination).
- 135 present answers on 52 test artists is still modest: one answer moves test recall by under one point, one
  artist can move several. Rare instruments (accordion, organ, trombone, voice) have 1–3 test answers each.
- Stitched long songs come from the official *train* partition, as before; they never reuse a locked test clip,
  but OpenMIC's partitions are not artist-separated, so a few artists may appear in both. No rule was tuned on them.
