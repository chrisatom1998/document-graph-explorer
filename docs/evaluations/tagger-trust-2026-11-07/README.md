# Let each tag trust its better model (2026-11-07)

Chris's idea #4: choose per tag which model to trust instead of one fixed rule. Inside the windows the trained tagger
heard, it **replaces** the other detectors for its tags, while their positives in sections it never scored still show.

`taggerPolicy.json` entries can now carry `trust` (src/audio/tagger.ts, applied in confidentSoundSummary.ts):

| trust | what it does |
|---|---|
| (none) | unchanged: tagger decides where it listened, other detectors' positives elsewhere stand |
| `sole` | the tagger's answer covers the whole recording, on recordings up to 30 s (its reach) |
| `either` | tagger can add the tag, its "no" does not remove the other detectors' positives |
| `both` | the tag shows only when the tagger and the other detectors both show it (its "no" covers unheard parts too) |

## History

The first version (before #323) found the main cause of many false alarms: on 10-30 s clips, other detectors firing in
the tail the tagger never heard re-added tags (siren 252 false alarms -> 12 with `sole`). #323 then made the tagger
listen to that tail for 12 outputs, which fixes most of those tags properly. This PR was re-measured on top of it.

## How it was picked (no audio, no models, $0)

`scripts/tagger-trust-whatif.ts` re-runs the app's display chain on the saved eval-tag caches for FSD50K eval
(10,231 clips, CLAP fingerprints + tagger scores per window, plus the #323 tail window:
reports/scoreboard/private/tail-window-2026-11-07/) under each mode. Its default rows match
`scripts/app-path-whatif.ts` on main exactly. Clips are split by uploader (fnv hash, as eval-tag.ts does).
`select.py` picks per tag on the **pick half only** (`python3 select.py modes-fsd50k-eval.json`; `sole` only, add
`sole,either,both` to see the held picks): the mode with the best F1 that passes 60/30, kept only if it beats the current
rule by more than 0.01 F1 (or the current rule fails). The check half is graded once.

## Result on main fdc51b8 (FSD50K eval, measured)

The pick half chose `sole` for rain ambience, gong and trumpet. Trumpet is left out: on the check half its F1 went
.738 -> .719 (still passing), so it is not a clear win.

| tag | main tp/fp (P/R) | this PR | check half P/R |
|---|---|---|---|
| gong | 52/33 (.61/.72) | 51/20 (.72/.71) | .57/.73 (fails) -> .71/.73 (passes) |
| rain ambience | 213/90 (.70/.88) | 203/60 (.77/.84) | .71/.88 -> .79/.82 |

Tags passing 60/30: check half 31 -> 32, pick half 32 -> 32, all clips 34 -> 34 (gong already passes on all clips via
#323's window vote, narrowly). No other tag changes.

Not shipped: every `either` / `both` pick. They gain recall on FSD50K, but their effect on sets we cannot replay here
is unmeasured. For guitar, the board's own CLAP rows suggest `either` would breach the 1% false-alarm cap on idmt-bass
(about 4.5%).

## Caveats

- For gong and rain ambience, a sound heard only in the unscored part of a clip up to 30 s no longer shows.
- The tagger cutoffs come from the published policy. PR #320 found some cutoffs were test-tuned.
- FSD50K eval is a board test set. Only the pick half chose modes.
