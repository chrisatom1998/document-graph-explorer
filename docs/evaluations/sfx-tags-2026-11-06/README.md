# Sound-effect tags from FSD50K (2026-11-06)

Five candidate tags (gunshot, vehicle, footsteps, thunder, phone ring) were built the same way as the acapella head (#297).
Gunshot and footsteps passed and ship. The other three did not.

## Recipe (fixed before any test clip was scored)
- **Fingerprints:** the app's own q8 CLAP window fingerprints (10 s windows, 5 s hop), made by `scripts/eval-tag.ts --score-only`.
- **Head:** logistic regression (C = 1, balanced classes) on the clip's mean unit window vector. The clip score is the
  highest window sigmoid.
- **Training clips:** FSD50K dev `train` split after the private exclude list. That is every positive, every clip of a
  confusable class, and 6,000 random others (11,951 clips).
- **Labels:**
  - gunshot = `Gunshot_and_gunfire`
  - vehicle = `Vehicle`
  - footsteps = `Walk_and_footsteps` (`Run` without it is skipped)
  - thunder = `Thunder` (`Thunderstorm` without it is skipped)
  - phone ring = `Telephone`
- **Cutoff:** the lowest value in 0.05..0.99 that reaches precision ≥ 0.65 with at least 3 hits on FSD50K dev `val`
  (2,144 clips, exclude list applied).
- **Judge:** run once, on all FSD50K eval clips (10,228 scored; no uploader overlap with dev) plus 4,096 NSynth test
  notes for false alarms. A tag passes at P ≥ 0.6, R ≥ 0.3 and NSynth false alarms ≤ 1%.

## Results (judge, scored once)
| tag | cutoff | P | R | tp / fp / pos | NSynth FA | result |
|---|---|---|---|---|---|---|
| gunshot | 0.78 | 0.684 | 0.903 | 121 / 56 / 134 | 2 / 4,096 | pass (60/60 too) |
| footsteps | 0.88 | 0.757 | 0.522 | 106 / 34 / 203 | 0 / 4,096 | pass |
| vehicle | 0.48 | 0.625 | 0.892 | 919 / 552 / 1,030 | 59 / 4,096 (1.4%) | fail: false alarms |
| thunder | 0.32 | 0.557 | 1.000 | 128 / 102 / 128 | 0 | fail: precision |
| phone ring | none | – | – | – | – | fail: no dev-val cutoff |

## Short clips (one-shots)
On clips of 2.25 s or less, the app keeps only learned heads marked `oneShot`. Without that flag, the app-path judge run
(`eval-tag --decide-only`) gave:
- gunshot: P 0.638 / R 0.552. All 51 short gunshot clips were missed.
- footsteps: P 0.786 / R 0.507.

Both heads therefore ship with `oneShot: true`. That choice was checked on dev val only, not on the judge set, through
the app path:

| head | without oneShot | with oneShot |
|---|---|---|
| gunshot | P 0.500 / R 0.419 (short R 0 of 18) | P 0.651 / R 0.903 (short R 0.83) |
| footsteps | P 0.680 / R 0.607 | P 0.679 / R 0.679 |

With the flag set, the app scores every clip the way the judge script did, so the judge numbers above are what the app
should show.

## Second batch (2026-11-06): explosion, glass break, clock, chimes, fire
- **Recipe:** the same, with `oneShot` set from the start.
- **Rules:** fixed in `rules.py` before any batch-2 score was computed.
  - explosion = `Explosion`. Clips that are only gunshots (`Gunshot_and_gunfire` without `Boom` or `Fireworks`) are
    skipped, because the gunshot tag owns those.
  - glass break = `Shatter`.
  - clock = `Clock`. Clips with `Tick` but no `Clock` are skipped.
  - chimes = `Chime`, which includes `Wind_chime`.
  - fire = `Fire`.
- **Training clips:** 13,463. That is the first batch's set plus 1,512 more dev-train clips that hold the new classes
  or their confusables, with the exclude list applied.

| tag | cutoff | P | R | tp / fp / pos | NSynth FA | result |
|---|---|---|---|---|---|---|
| clock | 0.71 | 0.654 | 0.918 | 89 / 47 / 97 | 0 | pass (60/60 too) |
| chimes | 0.98 | 0.912 | 0.608 | 62 / 6 / 102 | 0 | pass (60/60 too) |
| explosion | 0.72 | 0.571 | 0.890 | 121 / 91 / 136 | 7 | fail: precision |
| glass break | 0.22 | 0.543 | 0.990 | 95 / 80 / 96 | 0 | fail: precision |
| fire | none | – | – | – | – | fail: no dev-val cutoff |

The app path (`eval-tag --decide-only` with the shipped heads) gives the same numbers for clock and chimes.

## Third batch (2026-11-06): dog bark, cat meow, applause, knock, typing, train
None of these labels had been graded before, so FSD50K eval is unseen for them. The recipe is the same and `oneShot` is
on. The rules were fixed before any score was computed:
- dog bark = `Bark`. Clips with `Dog` but no `Bark` are skipped.
- cat meow = `Meow`. Clips with `Cat` but no `Meow` are skipped.
- applause = `Applause`. Clips with `Clapping` but no `Applause` are skipped.
- knock = `Knock`.
- typing = `Typing`.
- train = `Train`. Clips with `Rail_transport` but no `Train` are skipped.

The training set has 14,539 clips: the earlier batches' clips plus 1,077 more dev-train clips.

| tag | cutoff | P | R | tp / fp / pos | NSynth FA | result |
|---|---|---|---|---|---|---|
| typing | 0.73 | 0.778 | 0.842 | 123 / 35 / 146 | 0 | pass (70/70 too) |
| knock | 0.86 | 0.724 | 0.816 | 84 / 32 / 103 | 0 | pass (70/70 too) |
| applause | 0.29 | 0.659 | 0.940 | 141 / 73 / 150 | 0 | pass (60/60 too) |
| cat meow | 0.29 | 0.645 | 1.000 | 78 / 43 / 78 | 0 | pass (60/60 too) |
| train | 0.93 | 0.620 | 0.838 | 93 / 57 / 111 | 0 | pass (60/60 too) |
| dog bark | 0.15 | 0.452 | 0.844 | 103 / 125 / 122 | 0 | fail: precision |

The app path (`eval-tag --decide-only` with the shipped heads) gives identical numbers.

The app's model loader rejects any head with a cutoff below 0.5, and when it does it drops every learned head, not just
that one. Cat meow and applause were cut at 0.29 on dev val. Their shipped bias therefore adds logit(0.29) = ln(0.71/0.29),
so they cut at 0.5 and make the same decisions.

## Fresh-set retry (2026-11-06): vehicle, thunder, phone ring, explosion, fire
These five failed on FSD50K eval, so they were not graded on FSD50K eval again. Instead they were judged once on a new,
private test set: 1,063 BBC Sound Effects and ESC-50 clips that no training or test list had used before. The audio and
the lists stay private and are not in this repo. Glass break was skipped because the fresh set has only 5 positives.

The rules were fixed before any fresh clip was scored, and every choice below was made on FSD50K dev val only:
- Candidate A is the frozen head from its batch.
- Candidate B uses the same recipe, retrained on all our dev-train clips plus FSD50K eval. Eval no longer judges these
  tags, and it was not used for any choice.
- The cutoff is picked the same way as in the earlier batches. Each tag keeps whichever candidate has the higher dev-val F1.
  Fire found no cutoff with either candidate, so it was dropped.
- Pass needs all three: P >= 0.6 and R >= 0.3 on all fresh clips; the same on the strong-label clips; and false alarms of
  1% or less on 4,096 random NSynth **valid** notes. NSynth test had already been used, so the valid notes are new music
  negatives.

| tag | head | cutoff | all P / R | strong P / R | unseen-CD P / R | NSynth-valid FA | result |
|---|---|---|---|---|---|---|---|
| phone ring | B | 0.99 | 0.966 / 0.757 | 0.966 / 0.778 | 1.000 / 0.812 | 7 / 4,096 | pass (7 source groups only) |
| explosion | A | 0.72 | 0.797 / 0.596 | 0.762 / 0.658 | 0.667 / 0.500 | 15 / 4,096 | pass |
| thunder | A | 0.32 | 0.630 / 0.750 | 0.602 / 0.903 | 0.625 / 0.909 | 0 / 4,096 | pass (narrow) |
| vehicle | B | 0.52 | 0.648 / 0.735 | 0.622 / 0.827 | 0.610 / 0.825 | 72 / 4,096 (1.8%) | fail: music false alarms |
| fire | – | – | – | – | – | – | fail: no dev-val cutoff |

The app path (`eval-tag --decide-only` with the shipped heads) gives identical numbers on the fresh set and on NSynth valid.

Two caveats:
- Thunder and explosion ship the same heads that missed on FSD50K eval: thunder had P 0.557 there and explosion 0.571.
  They have now passed one clean, unseen test and failed one, so treat both as borderline.
- The fresh set has no clips of 2.25 s or less, so the one-shot path was only tested on FSD50K.

Thunder was cut at 0.32 on dev val. Its shipped bias therefore adds logit(0.32), so it cuts at 0.5 and makes the same
decisions.

**Decision (Chris, Nov 6 2026 PT):** thunder and explosion ship as `maybe` heads, which the app shows faded. They become
normal tags only after a second held-out set confirms them. Phone ring ships as a normal tag. On FSD50K eval, the one-shot
subsets are small: thunder R 1.0 on 4 clips and explosion R 0.909 on 11 clips.
