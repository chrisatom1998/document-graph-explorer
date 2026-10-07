# Every sound tag against 70/70 (2026-10-06)

Bar: a tag passes when precision AND recall are both at least 0.70 (✓). Tags below 70 still show in the app, marked by provenance.
App: main after PR #132 and PR #136 (the full-mix voice veto). The full-song Jamendo run tested main @ f299e13.

## The short version

- **Short clips (one-shots, loops, short recordings), 111 tags:** 27 pass 70/70. Most character tags (airy, bright, warm...) and many production tags are far below.
- **Whole songs with complete labels (DJ clip tests, 11 instruments):** 7 of 11 pass on both rounds: drums, voice, synth, piano, guitar, cymbals, violin. Still short: bass (P 0.21), organ (P 0.62), trumpet (P 0.65), sax (R 0.29).
- **Whole songs, 600 new MTG-Jamendo songs (26 tags):** recall reaches 70 for drums 0.81, synth 0.89, guitar 0.80, piano 0.78, voice 0.77, flute 0.74. Precision here is only a floor, because uploaders tag few instruments (most songs with singing are not tagged "voice"). That is why the floors say little: they run from 0.00 (trombone, horn) to 0.88 (accordion), three tags that were never shown (electric guitar, oboe, harmonica) have none, and only accordion's clears 0.70 (with recall 0.22). No tag "passes" on this set; the DJ tests, which label everything, are the precision numbers to trust. Clear recall gaps on whole songs: electric piano 0.16, organ 0.14, strings 0.21, trumpet 0.32, bass guitar 0.39, violin 0.41, accordion 0.22; trombone, horn, oboe and harmonica are never found (0).
- **Solo orchestral notes (TinySOL, 840 notes, 11 tags):** violin, cello and bassoon pass. Flute, clarinet and trumpet are shown on most notes of every instrument (precision 0.11-0.14). Horn and accordion are almost never found.
- **Threshold calibration:** the pre-registered rule (pick a lower threshold on half the songs, keep it only if the other half gains 10 points of recall and holds precision at 70) adopted nothing: no model score separates these tags well enough on whole songs. The one fix that worked is the voice veto (#136): false "voice" on DJ round 2 went from 12.5% to 3.4% of shown voice tags with no recall lost, and 26 to 9 of 150 instrumental sample-pack loops.

## What cannot be measured

- **84 of the 111 tags have no full-song labels anywhere** (all character tags, almost all production/effect tags, and many instruments such as djembe, kalimba, marimba, mandolin, tabla). They are only scored on short clips.
- **Active tags with no clean short-clip test:** bass hit and tabla have no short-clip labels (tabla only in FSD50K, which trained the current models, so not clean), and guitar has none either, though it is judged on whole songs (DJ tests and Jamendo). From the 198-tag list: steel drum had too few clips to test, and waterphone (15 real recordings) and vocal shush (22 clips, extra sources only) were tested and fail (recall 0.13 and 0.09), so they are not in the app.
- Trombone, harp, chiptune synth, choir and atmospheric pad have under 20 labelled songs in the Jamendo set, too few to judge.

## Biggest remaining problem

The CLAP "trained head" over-fires on short clips: it puts flute, clarinet and trumpet on most solo notes, and "voice" on 38 of the sample-pack loops (808 hits, drum and bass loops under 10 s) that the full-mix veto cannot reach. Thresholds alone don't fix it, because the scores of right and wrong tags overlap. It needs the retrained heads from the custom-model thread, or a short-clip veto calibrated on clean data.

## Every tag

Columns are precision / recall. "Whole songs (Jamendo)" shows recall, the precision floor, and the number of tagged songs (shown when at least 10).

| Tag | Group | Short clips | Whole songs (DJ test R1) | Whole songs (Jamendo) | Solo notes (TinySOL) |
|---|---|---|---|---|---|
| ambient drone | production | 1.00 / 0.89 ✓ |  |  |  |
| beatbox | production | 1.00 / 0.97 ✓ |  |  |  |
| cowbell | production | 1.00 / 0.76 ✓ |  |  |  |
| crowd ambience | production | 0.89 / 0.76 ✓ |  |  |  |
| ride cymbal | production | 0.76 / 0.84 ✓ |  |  |  |
| sub bass | production | 0.79 / 0.80 ✓ |  |  |  |
| top loop | production | 0.91 / 0.89 ✓ |  |  |  |
| vinyl scratch | production | 1.00 / 0.70 ✓ |  |  |  |
| vocal ad-lib | production | 0.83 / 1.00 ✓ |  |  |  |
| vocal chant | production | 0.73 / 0.81 ✓ |  |  |  |
| vocal laugh | production | 0.92 / 0.87 ✓ |  |  |  |
| whisper | production | 0.96 / 0.75 ✓ |  |  |  |
| whoosh | production | 0.94 / 0.84 ✓ |  |  |  |
| accordion | source | 1.00 / 0.75 ✓ |  | R 0.22, P ≥ 0.88 (32) | 1.00 / 0.05 |
| acoustic guitar | source | 0.87 / 0.89 ✓ |  | R 0.03, P ≥ 0.50 (63) |  |
| drums | source | 0.95 / 0.80 ✓ | 0.86 / 0.97 ✓ | R 0.81, P ≥ 0.30 (134) |  |
| electric guitar | source | 0.96 / 0.95 ✓ |  | R 0.00, P ≥ — (77) |  |
| harmonica | source | 0.91 / 0.91 ✓ |  | R 0.00, P ≥ — (20) |  |
| harp | source | 0.98 / 0.85 ✓ |  | R 0.35, P ≥ 0.43 (17) |  |
| jaw harp | source | 0.71 / 0.79 ✓ |  |  |  |
| mallet instrument | source | 0.98 / 0.83 ✓ |  |  |  |
| organ | source | 0.98 / 0.92 ✓ | 0.62 / 0.95 | R 0.14, P ≥ 0.07 (36) |  |
| piano | source | 1.00 / 0.78 ✓ | 1.00 / 0.87 ✓ | R 0.78, P ≥ 0.38 (156) |  |
| singing bowl | source | 0.96 / 0.71 ✓ |  |  |  |
| strings | source | 0.98 / 0.87 ✓ |  | R 0.21, P ≥ 0.21 (47) |  |
| trumpet | source | 0.91 / 0.89 ✓ | 0.65 / 0.77 | R 0.32, P ≥ 0.19 (41) | 0.14 / 1.00 |
| ukulele | source | 1.00 / 0.72 ✓ |  |  |  |
| cymbal | production | 0.90 / 0.69 | 0.94 / 0.98 ✓ |  |  |
| drum loop | production | 0.74 / 0.67 |  |  |  |
| kick | production | 0.69 / 0.82 |  |  |  |
| open hi-hat | production | 0.61 / 0.71 |  |  |  |
| percussion loop | production | 0.88 / 0.63 |  |  |  |
| snare roll | production | 0.83 / 0.67 |  |  |  |
| spoken phrase | production | 0.88 / 0.61 |  |  |  |
| synth arpeggio | production | 0.67 / 0.66 |  |  |  |
| vocal chops | production | 0.67 / 0.73 |  |  |  |
| gong | source | 0.98 / 0.69 |  |  |  |
| synthesizer | source | 0.61 / 0.76 | 0.94 / 0.94 ✓ | R 0.89, P ≥ 0.37 (184) |  |
| airy | character | 0.32 / 0.06 |  |  |  |
| bright | character | 0.23 / 0.05 |  |  |  |
| dark | character | 0.45 / 0.28 |  |  |  |
| distorted | character | 0.03 / 0.09 |  |  |  |
| falling | character | 0.78 / 0.48 |  |  |  |
| glassy | character | 0.85 / 0.50 |  |  |  |
| nasal | character | 0.00 / 0.00 |  |  |  |
| percussive | character | 0.41 / 0.15 |  |  |  |
| pulsing | character | 0.00 / 0.00 |  |  |  |
| rhythmic | character | 0.40 / 0.07 |  |  |  |
| staccato | character | 0.60 / 0.21 |  |  |  |
| sustained | character | 0.06 / 0.01 |  |  |  |
| swelling | character | 0.32 / 0.11 |  |  |  |
| warm | character | 0.41 / 0.13 |  |  |  |
| wobbling | character | 0.63 / 0.25 |  |  |  |
| 808 bass | production | 0.83 / 0.37 |  |  |  |
| acid synth | production | 1.00 / 0.40 |  |  |  |
| atmospheric pad | production | 0.70 / 0.32 |  | R 0.16, P ≥ 0.10 (19) |  |
| bass growl | production | 0.45 / 0.71 |  |  |  |
| bird ambience | production | 0.55 / 0.40 |  |  |  |
| breakbeat | production | 0.86 / 0.31 |  |  |  |
| chiptune synth | production | 0.86 / 0.52 |  | R 0.64, P ≥ 0.39 (11) |  |
| choir | production | 0.75 / 0.51 |  | R 0.16, P ≥ 0.60 (19) |  |
| chops | production | 0.52 / 0.55 |  |  |  |
| clap | production | 0.79 / 0.51 |  |  |  |
| clave | production | 0.78 / 0.30 |  |  |  |
| closed hi-hat | production | 0.41 / 0.86 |  |  |  |
| crash cymbal | production | 0.96 / 0.59 |  |  |  |
| drum fill | production | 0.56 / 0.64 |  |  |  |
| finger snap | production | 0.82 / 0.46 |  |  |  |
| foghorn bass | production | 0.19 / 0.19 |  |  |  |
| hi-hat | production | 0.56 / 0.74 |  |  |  |
| hi-hat loop | production | 0.59 / 0.91 |  |  |  |
| impact | production | 0.89 / 0.38 |  |  |  |
| percussion hit | production | 0.41 / 0.34 |  |  |  |
| rain ambience | production | 0.67 / 0.30 |  |  |  |
| reverse effect | production | 0.63 / 0.46 |  |  |  |
| riser | production | 0.59 / 0.60 |  |  |  |
| shaker | production | 0.85 / 0.51 |  |  |  |
| snare | production | 0.71 / 0.53 |  |  |  |
| stutter effect | production | 1.00 / 0.10 |  |  |  |
| synth sequence | production | 0.22 / 0.08 |  |  |  |
| tambourine | production | 0.60 / 0.44 |  |  |  |
| texture | production | 0.81 / 0.42 |  |  |  |
| tom | production | 0.57 / 0.47 |  |  |  |
| vocal breath | production | 0.61 / 0.20 |  |  |  |
| vocal gasp | production | 1.00 / 0.53 |  |  |  |
| vocal phrase | production | 0.93 / 0.41 |  |  |  |
| water ambience | production | 0.76 / 0.36 |  |  |  |
| bass guitar | source | 0.97 / 0.21 | 0.21 / 0.67 | R 0.39, P ≥ 0.51 (145) |  |
| bassoon | source | 1.00 / 0.13 |  |  | 1.00 / 0.77 ✓ |
| cello | source | 0.71 / 0.45 |  | R 0.58, P ≥ 0.27 (41) | 0.92 / 0.97 ✓ |
| clarinet | source | 0.60 / 0.29 |  | R 0.68, P ≥ 0.16 (34) | 0.11 / 0.88 |
| djembe | source | 0.65 / 0.25 |  |  |  |
| electric piano | source | 0.69 / 0.48 |  | R 0.16, P ≥ 0.14 (43) |  |
| flute | source | 0.81 / 0.42 |  | R 0.74, P ≥ 0.19 (43) | 0.11 / 1.00 |
| horn | source | 0.81 / 0.46 |  | R 0.00, P ≥ 0.00 (21) | 0.00 / 0.00 |
| kalimba | source | 1.00 / 0.48 |  |  |  |
| mandolin | source | 1.00 / 0.09 |  |  |  |
| marimba | source | 0.91 / 0.39 |  |  |  |
| oboe | source | 0.67 / 0.05 |  | R 0.00, P ≥ — (20) | 0.62 / 0.38 |
| saxophone | source | 0.73 / 0.39 | 1.00 / 0.29 | R 0.54, P ≥ 0.58 (46) | 0.31 / 0.37 |
| sound effect | source | 0.51 / 0.15 |  |  |  |
| triangle | source | 0.79 / 0.32 |  |  |  |
| trombone | source | 1.00 / 0.11 |  | R 0.00, P ≥ 0.00 (14) | 0.42 / 0.55 |
| vibraphone | source | 0.60 / 0.07 |  |  |  |
| violin / fiddle | source | 0.84 / 0.44 | 0.73 / 0.92 ✓ | R 0.41, P ≥ 0.23 (56) | 0.94 / 0.97 ✓ |
| voice | source | 0.81 / 0.57 | 0.92 / 0.96 ✓ | R 0.77, P ≥ 0.15 (52) |  |
| whistle | source | 0.83 / 0.47 |  |  |  |
| xylophone | source | 0.57 / 0.22 |  |  |  |
| bass hit | production | no test |  |  |  |
| guitar | source | no test | 0.94 / 0.97 ✓ | R 0.80, P ≥ 0.46 (167) |  |
| tabla | source | no test |  |  |  |

## Sources

- Short clips: docs/evaluations/open-vocab-2026-10-05/scorecard.json (round 19).
- DJ tests: re-scored round 1/2 exports, docs/evaluations/all-tags-2026-10-06/judge/ (round 2 agrees: 7/11).
- Jamendo: /mnt/project-files/reports/hf-eval/all-tags-jamendo-main/ (600/600 songs, split-0 validation, middle 30 s). Selection and rules: docs/evaluations/all-tags-2026-10-06/PREREGISTRATION.md.
- TinySOL: docs/evaluations/all-tags-2026-10-06/results/tinysol-main-b232c07/. Bassoon is not held out (round 23 trained on TinySOL notes). On the folds the training thread keeps out (0-1), results are within a few points of the full set.
