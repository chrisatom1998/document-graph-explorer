# Cut-offs for precise-but-shy tags (2026-10-10, ready to run)

Chris asked for the tags under the 50/50 bar to reach it without training a new model. Ten heads score high precision
but recall just under 0.50 on their held-out clips, so a lower cut-off on the same kind of head is the obvious lever.

| tag | precision / recall now | kind | tested on | from |
|---|---|---|---|---|
| synth sequence | 1.00 / 0.48 | label | extra sources | round 14 |
| stutter effect | 1.00 / 0.45 | label | extra sources | round 14 |
| bassoon | 0.91 / 0.47 | instrument | real recordings | round 23 |
| electric piano | 0.85 / 0.45 | instrument | real recordings | round 18 |
| flute | 0.82 / 0.48 | instrument | real recordings | round 18 |
| horn | 0.81 / 0.46 | instrument | real recordings | round 19 |
| cello | 0.78 / 0.49 | instrument | real recordings | round 18 |
| texture | 0.73 / 0.48 | family | library brands | round 16 |
| atmospheric pad | 0.67 / 0.48 | label | real recordings | round 21 |
| breakbeat | 0.66 / 0.49 | label | library brands | round 18 |

Not in this list: glassy (a timbre rule word, kept maybe on purpose) and violin / fiddle (a zero-shot head; its cut-off
comes from `zero-shot-heads.py`, not this trainer).

## Why this can't be done by just editing the threshold in learned.json

- `train-with-extras.py` already picks each cut-off to balance precision and recall, on out-of-fold training rows from
  *every* source. Renders and tag-mined clips score higher than the real recordings the test uses, so the cut-off
  lands too high for the test and recall comes up short. Re-picking it the same way gives the same number.
- Each shipped head was refitted on every usable row (`EXPORT`), held-out clips included, so scoring a new cut-off for
  the shipped weights on the old held-out clips would grade the head on clips it has heard.
- The fingerprints and round manifests are on Chris's Mac (`dj-training-fingerprints`), not in the repo or on the Hub;
  Freesound previews return 403 from the cloud sandbox, so they cannot be re-embedded there.

## What changed

`CAL=test-like` in `scripts/train-with-extras.py`: the cut-off is picked only on out-of-fold training rows from the same
kind of source as that tag's test (library brands, real recordings or extra sources), falling back to every row when
fewer than 10 positives match. The held-out test still plays no part, and results record `calibratedOn`. The recipe
is the round's own: same extras, same small linear head over CLAP fingerprints, no new audio and no new network. Only
the rule that picks the cut-off differs.

## Run (on Chris's Mac)

Use each round's own extras (listed in its `*-results.json` under `extras`; rounds 16-21 all use the same 13) and,
as in `round16-clean-2026-10-10`, the FSD50K eval-clip `EXCLUDE` list so the scoreboard's judge set stays unheard.

```sh
CAL=test-like BAR=0.5 EXPORT=0.5 EXCLUDE=<fsd50k-eval-exclude.json> \
ONLY='label:synth sequence,label:stutter effect,instrument:bassoon,instrument:electric piano,instrument:flute,instrument:horn,instrument:cello,family:texture,label:atmospheric pad,label:breakbeat' \
python3 scripts/train-with-extras.py retune.json <round extras: name=manifest.json@fingerprint_dir ...>
```

Then, for each tag whose `retune.json` row has precision AND recall >= 0.50, ship it the usual way: replace that head in
`public/sound-model/learned.json` (weights, bias, threshold; drop `maybe`), re-pin `manifest.json`, commit
`retune.json` here so `scripts/head-scorecard.py` matches it, add the head to `PROMOTED` in
`src/audio/soundTagBar.test.ts` and bump `INSTRUMENT_ANALYSIS_REVISION`. A tag still below 0.50 stays maybe; a lower
cut-off only trades precision it does not have to spare.

Run once without `CAL` first: it should reproduce the rounds' scores (as round16-clean did) before trusting the change.
