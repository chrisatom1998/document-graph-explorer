# All-tags tagger blend: runs 3 and 5 (2026-10-09)

The app's trained tagger is now one ONNX file holding two networks that share one log-mel front end. Each of the 20
outputs the app reads comes from whichever network scored better on held-out audio. Everything else about how the
app runs the tagger is unchanged from [all-tags-model-2026-10-06](../all-tags-model-2026-10-06/README.md): the windows,
the max-over-windows rule, the long-recording rules, and which tags it decides.

## What ships

| | |
|---|---|
| Networks | Run 3: EfficientAT `mn10_as`, the model shipped in #129. Run 5: EfficientAT `mn20_as` (17.3M parameters), started from run 4 with bass, organ, cello, trumpet, violin and saxophone windows shown twice per epoch |
| File | `public/tagger-model/model.onnx`, 91,428,859 bytes (91.4 MB), from `cmjatom/dge-all-tags-tagger-nc` at the revision pinned in `manifest.json`. ONNX matches each run's PyTorch output within 2e-6 |
| Download | +68.8 MB over the old tagger (total about 632 MB) |
| Cost per track | Both networks run on every window. On one CPU thread `mn20_as` takes about twice as long as `mn10_as`, so a window costs about three times what it did |
| Licence | **CC BY-NC-SA 4.0 (non-commercial).** Run 5's thresholds were calibrated with Mixing Secrets (RawStems) validation songs, whose licence is non-commercial. EfficientAT code and AudioSet weights stay MIT |

Built and published by `.github/workflows/tagger-combine.yml` (`scripts/audio-model/combine.py`,
`hf-combine-job.sh`). The repo also holds `picks.json` (every tag's held-out numbers per run), `eval.txt` (the blended
file's own held-out scores) and `parity.json` (the browser parity reference, `src/audio/taggerParity.fixture.json`).

## How each tag was picked

A newer run takes a tag only when two things hold. Its mean min(precision, recall) on the tag's held-out sets must be
at least 0.01 higher than run 3's. And it must not drop below 70/70 on any set where run 3 passes. Instruments are
judged on DJ clip rounds 1 and 2. App sound tags are judged on FSD50K eval, NSynth test, the NSynth effect renders and
the held-out Freesound uploaders. Drums stays on run 3 because its long-recording threshold was tuned on run 3's scores.
None of these sets was trained or tuned on.

| Tag | Network | Run 3 held-out P/R | Blend held-out P/R | Tested |
|---|---|---|---|---|
| guitar | run 5 | .94/1.00, .83/.95 | .97/1.00, .91/.95 | yes |
| violin | run 5 | .80/1.00, .86/.80 | .92/.92, .79/.73 | yes |
| trumpet | run 5 | .88/.82, .60/.67 | .79/.88, .68/.83 | no |
| percussive | run 5 | .98/.80 | .93/.84 | yes |
| wobbling | run 5 | .82/.70 | .74/.79 | yes |
| pulsing | run 5 | .55/.77 | .84/.77 | yes (was no) |
| distorted | run 5 | .74/.68, .63/.70 | .73/.72, .64/.73 | no |
| reverse effect | run 5 | .96/.57 | .86/.77 | yes (was no) |
| rain ambience | run 5 | .93/.62 | .86/.66 | no |
| drums, piano, cymbals, saxophone, bass, swelling, falling, bright, dark, bird ambience, vocal breath | run 3 | unchanged | unchanged | unchanged |

"Tested" means held-out precision and recall both reached 0.70 on every complete-label set. Untested tags still show,
as "maybe". The blend's thresholds are each network's own validation thresholds. Bass and organ are still below the
bar. A run trained with the Mixing Secrets bass and organ songs is in progress and will join the blend only if it
wins tags by the same rule.

Run 4 (`mn20_as`, 2026-10-09) would only add "bright", by less than the 0.01 margin, so the blend leaves it out.
Held-out results per run are in `picks.json` on the model repo.
