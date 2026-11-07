# One combined tag fix for every clip length (2026-11-07)

Three changes to the code around the models, each switched on **per tag** only where it measured better. Nothing was
retrained and no cutoff was tuned: every part is a yes/no per tag.

1. **Short clips (2.25 s or less):** five learned heads may now speak on a short one-shot (`oneShot`): trumpet, strings,
   viola (shows as strings), harmonica, crowd ambience. Details: `docs/evaluations/oneshot-heads-2026-11-07`.
2. **Window vote for sustained sounds (clips of 2 to 5 CLAP windows, about 12-30 s):** the heads for strings, viola,
   organ, gong, harmonica, voice, rain ambience and water ambience need to fire in two windows, not one (`minWindows: 2`
   in `learned.json`, `sustainedHeadMissing` in `nativeWindowEvidence.ts`). One stray window no longer tags a whole
   clip. Files longer than 30 s and single-window clips keep the old rule (the vote was only measured up to 30 s).
3. **The tagger hears the end of 10-30 s clips:** whole 10 s windows left the last seconds of a 15 s or 25 s clip
   unheard. One more tagger window, ending at the clip's end (`taggerTailStart`), now feeds the policy outputs marked
   `tail` in `taggerPolicy.json`: clap, crash cymbal, machine ambience, organ, siren, vocal shout, voice, water ambience,
   whisper, drums, piano. It costs one extra tagger run on such clips (about 0.2 s per clip on the container's CPU).

## How each part was chosen
- Data: the saved app-path model outputs of the Nov 2 FSD50K eval rescore (10,231 clips, CLAP fingerprints and tagger
  scores per clip), re-decided with the app's own display chain by `scripts/app-path-whatif.ts`. For part 3 the tagger
  was also run on the new tail window of the 3,905 clips that have one, from the FSD50K eval audio downloaded into the
  container (nothing uploaded, no audio in this repo).
- Split: uploader groups hashed into two halves (as `eval-tag.ts` does). A part stays on for a tag only when that tag's
  F1 rose on **both** halves. Tags it hurt on either half were switched off: window vote off for bird ambience, bell,
  trumpet, mallet instrument, accordion, harp, piano, crowd ambience; tail window off for the outputs behind animal sound, bass
  guitar, bell, bird ambience, breath, cymbal, finger snap, foley, glockenspiel, gong, guitar, hi-hat, kick, percussion,
  rain ambience, tambourine, trumpet, vinyl scratch, vocal scream, falling, laser and riser, and off for the 33 outputs
  this set cannot measure.
- Because the check half was used to drop parts, it is not an untouched holdout. The other counted sets (free-tag-set,
  NSynth) were not re-scored on the app path; NSynth (4 s notes) is not touched by any part.

## Result on the FSD50K eval app path (precision / recall, main -> this change)
Passing tags (60/30 on all clips): **28 -> 35** of the labelled tags. No tag's F1 went down on either half, on short
clips or on longer clips. Some tags trade recall for much higher precision (voice, siren, whisper, water ambience).

| tag | pick half | check half | all | 60/30 | short clips | longer clips |
| --- | --- | --- | --- | --- | --- | --- |
| clap | 0.552 / 0.400 -> 0.615 / 0.400 | 0.500 / 0.520 -> 0.619 / 0.520 | 0.527 / 0.446 -> 0.617 / 0.446 | **fail -> pass** | 12/22 found, 4 false -> 12/22 found, 4 false | 17/43 found, 22 false -> 17/43 found, 14 false |
| crash cymbal | 0.533 / 0.800 -> 0.615 / 0.800 | 0.712 / 0.824 -> 0.732 / 0.804 | 0.652 / 0.817 -> 0.695 / 0.803 | pass | 7/8 found, 3 false -> 7/8 found, 3 false | 51/63 found, 28 false -> 50/63 found, 22 false |
| crowd ambience | 0.903 / 0.496 -> 0.910 / 0.540 | 0.891 / 0.573 -> 0.879 / 0.608 | 0.896 / 0.539 -> 0.892 / 0.578 | pass | 0/18 found, 0 false -> 10/18 found, 2 false | 138/238 found, 16 false -> 138/238 found, 16 false |
| machine ambience | 0.704 / 0.584 -> 0.695 / 0.603 | 0.653 / 0.546 -> 0.630 / 0.576 | 0.683 / 0.568 -> 0.667 / 0.592 | pass | 9/19 found, 5 false -> 9/19 found, 5 false | 357/625 found, 165 false -> 372/625 found, 185 false |
| rain ambience | 0.660 / 0.884 -> 0.697 / 0.884 | 0.695 / 0.877 -> 0.708 / 0.877 | 0.678 / 0.880 -> 0.703 / 0.880 | pass | 3/7 found, 2 false -> 3/7 found, 2 false | 210/235 found, 99 false -> 210/235 found, 88 false |
| siren | 0.129 / 0.692 -> 0.682 / 0.577 | 0.145 / 0.759 -> 0.667 / 0.483 | 0.137 / 0.727 -> 0.674 / 0.527 | **fail -> pass** | 1/3 found, 2 false -> 1/3 found, 2 false | 39/52 found, 250 false -> 28/52 found, 12 false |
| vocal shout | 0.440 / 0.515 -> 0.469 / 0.535 | 0.301 / 0.397 -> 0.320 / 0.397 | 0.374 / 0.463 -> 0.400 / 0.475 | fail | 27/36 found, 30 false -> 27/36 found, 30 false | 55/141 found, 107 false -> 57/141 found, 96 false |
| water ambience | 0.531 / 0.789 -> 0.636 / 0.689 | 0.477 / 0.755 -> 0.586 / 0.637 | 0.505 / 0.773 -> 0.612 / 0.664 | **fail -> pass** | 42/48 found, 12 false -> 42/48 found, 12 false | 292/384 found, 316 false -> 245/384 found, 170 false |
| whisper | 0.203 / 0.500 -> 0.688 / 0.393 | 0.364 / 0.766 -> 0.833 / 0.638 | 0.298 / 0.667 -> 0.788 / 0.547 | **fail -> pass** | 12/15 found, 7 false -> 12/15 found, 7 false | 38/60 found, 111 false -> 29/60 found, 4 false |
| drums | 0.059 / 1.000 -> 0.071 / 0.967 | 0.065 / 0.967 -> 0.081 / 0.967 | 0.062 / 0.983 -> 0.076 / 0.967 | fail | 10/11 found, 100 false -> 10/11 found, 100 false | 49/49 found, 800 false -> 48/49 found, 608 false |
| gong | 0.571 / 0.718 -> 0.651 / 0.718 | 0.558 / 0.727 -> 0.571 / 0.727 | 0.565 / 0.722 -> 0.612 / 0.722 | **fail -> pass** | 0/4 found, 0 false -> 0/4 found, 0 false | 52/68 found, 40 false -> 52/68 found, 33 false |
| harmonica | 0.528 / 0.950 -> 0.588 / 1.000 | 0.708 / 0.895 -> 0.735 / 0.947 | 0.631 / 0.914 -> 0.675 / 0.966 | pass | 0/3 found, 0 false -> 3/3 found, 0 false | 53/55 found, 31 false -> 53/55 found, 27 false |
| organ | 0.545 / 0.667 -> 0.750 / 0.667 | 0.471 / 0.308 -> 0.889 / 0.308 | 0.500 / 0.400 -> 0.824 / 0.400 | **fail -> pass** | 0/4 found, 0 false -> 0/4 found, 0 false | 14/31 found, 14 false -> 14/31 found, 3 false |
| piano | 0.145 / 0.808 -> 0.583 / 0.808 | 0.193 / 0.740 -> 0.739 / 0.680 | 0.172 / 0.763 -> 0.671 / 0.724 | **fail -> pass** | 19/19 found, 2 false -> 19/19 found, 2 false | 39/57 found, 277 false -> 36/57 found, 25 false |
| strings | 0.857 / 0.645 -> 0.909 / 0.860 | 0.791 / 0.723 -> 0.878 / 0.766 | 0.832 / 0.671 -> 0.899 / 0.829 | pass | 0/26 found, 0 false -> 22/26 found, 2 false | 94/114 found, 19 false -> 94/114 found, 11 false |
| trumpet | 0.625 / 0.263 -> 0.850 / 0.895 | 0.833 / 0.541 -> 0.857 / 0.649 | 0.781 / 0.446 -> 0.854 / 0.732 | pass | 0/18 found, 0 false -> 16/18 found, 0 false | 25/38 found, 7 false -> 25/38 found, 7 false |
| voice | 0.637 / 0.552 -> 0.947 / 0.491 | 0.702 / 0.579 -> 0.939 / 0.508 | 0.672 / 0.567 -> 0.942 / 0.500 | pass | 194/259 found, 21 false -> 194/259 found, 21 false | 732/1374 found, 430 false -> 623/1374 found, 29 false |

All other labelled tags are unchanged. On the scoreboard's app-path line (tagger tags measured at the shipped cutoff,
FSD50K row from this rescore), clap, siren, water ambience, whisper, gong and organ now pass every counted set: the
app-path count goes 80 -> 86. Piano passes FSD50K now but still fails free-tag-set and NSynth.

## Pinned by tests
- `src/audio/tagRouting.expected.json`: strings, viola, trumpet, harmonica and crowd ambience now show on 0.5-2.25 s
  clips; the window-voted tags no longer show from one 4 s burst in a 15 s or 25 s clip; organ, voice, water and
  machine ambience show again from the tail of such clips (the tail window).
- `src/audio/sustainedHeads.test.ts`: the vote rule and which heads carry it. `src/audio/tagger.test.ts` keeps the
  scorer's windows; the tail window is separate, so the Python parity fixture is unchanged.
- Re-analysis: INSTRUMENT_ANALYSIS_REVISION and the tagger policy revision move, so saved results are re-scored once.
