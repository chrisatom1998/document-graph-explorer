# Reference-sound heads with training-only cutoffs (Oct 31 2026)

**Shipped:** one reference-sound (neighbour) head, for **bitcrushed**, in `public/sound-model/learned.json` (`neighbours`).
A clip longer than 2.25 s gets the tag when its CLAP fingerprint sits closer to bitcrushed training clips than to a
shared bank of 1,000 unrelated training sounds (mean of the 5 best cosines each). Code path from PR #237; no app code
changed. Instrument analysis revision 139/140.

## What is new compared with #237

The cutoff never looked at a test clip. It is the 99th percentile of the margin on 20,000 held-out **training** clips
without the tag (about 1% false alarms on training data). #237 fitted its cutoffs on half of the test sets, and that
cutoff did not hold on the other half (it was undone in #238).

- Reference banks: round 11 training pool (57,892 clips with CLAP features). The private exclude list dropped 4,697,
  `split=heldout` commercial rows were dropped (1,202), and 27 clips within cosine 0.995 of any test fingerprint were
  dropped. bitcrushed: 119 training clips, all used as examples. Out-of-fold training recall 0.71.
- Vectors are stored as int8 and the cutoff was computed on the int8-decoded vectors, so it matches the browser.

## Measured on the app path (all fresh test clips, the app's own tag code)

`app_tags_v2.ts` (the app's `learnedDjScores` + `selectDjTags`, one-shot rule) on every test fingerprint, then
`real_app_filter.py` and `app_clap_score.py`, before and after. Only bitcrushed changed.

| Tag | Set | Before | After |
|---|---|---|---|
| bitcrushed | free-tag-set test (10 pos, 219 neg) | 0.00 / 0.00 | **1.00 / 0.80** (8 TP, 0 FP) |

Unlabelled firing rate elsewhere: FSD50K 9 of 10,228, NSynth 29 of 4,096, SASS-E 0, IDMT bass 0.
App-path 60/30 count with freshly regenerated CLAP-side decisions: 79 -> 80, no tag lost.

## What did not ship

Heads for 28 other failing or unmeasured CLAP-side tags were built the same way and scored at three training cutoffs
(1%, 0.5%, 0.1% training false alarms). None passed. With the app's union rule (trained head OR neighbour head),
they add false alarms on FSD50K and NSynth faster than they add hits: for example acoustic guitar FSD50K precision
0.90 -> 0.28, vocal shout 0.53 -> 0.20, cowbell 0.90 -> 0.48 at 1%; rimshot went pass -> fail. At 0.1% the heads
are nearly silent. Training-data false-alarm rates do not transfer to the test sources for most tags.

## Reproduce (container only; test fingerprints never leave it)

1. Download `round11/{run9,emptytags,commercial}` from the private `dge-audio-training` bucket to `/var/tmp/rb/feat`.
2. `scripts/ref-blend/build_pool.py`, then the test-leak `filter_training.py` on `pool.csv` -> `pool-filtered.csv`.
3. `B=1000 scripts/ref-blend/build_nb.py 0.99 learned-bit1k.json bitcrushed`.
4. `scripts/ref-blend/pipe.sh <variant>` for the variant (run the base with no learned.json argument, i.e. the shipped file), then `diff.py` on the two `app-clap-*.json`.
