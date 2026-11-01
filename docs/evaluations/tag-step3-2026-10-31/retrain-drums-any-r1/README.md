# Step 3 retrain on the 46-tag judge set (Oct 31, 2026)

The retrain Chris approved (HF job `6ae66f890e0338d1bb7d4830`, l4x1, 3:45 to 7:17 PM Pacific, about $2.83) is scored here
on the same 681 FSD50K eval clips and 46 tags as the rest of this PR, with drums = any drum sound. Scoring ran on the box
CPU and cost nothing. No cutoff was tuned on these clips.

- Model: private `cmjatom/dge-sound-tag-candidate`, commit `59a3370c0c`, folder `drums-any-r1` (mn20_as, 3 epochs, from
  `all-tags-recall2`, training commit `df47819`). ONNX sha256 `ee2dfc12…`. It is one run, not a blend.
- Compared with: the shipped blend `cmjatom/dge-all-tags-tagger-nc` at `410638a` (8 runs, sha256 `14f80825…`) under this
  PR's decisions (`../after-drums-any/`).
- How: the candidate's `onnx/model.onnx` and `model.json` swapped into a local `public/tagger-model/`.
  `src/audio/taggerPolicy.json` got the candidate's sha and each tag's cutoff from the run's own `thresholds.json`. Every
  other part of the policy and app (CLAP heads, short-clip, long-recording rules) stayed the same. Then
  `scripts/eval-tag.ts` score + decide with 4 shards (what `scripts/tag-baseline/run.sh` does) and `summarize.py`.
  None of these swapped files are committed.
- Check: scoring the shipped model again from the cache gives exactly `../after-drums-any/` (micro .629, macro .641,
  identical per-tag CSV).
- Caveat: drums' long-recording `max` cutoff (0.5757) was tuned on the shipped model's scores and stays as it is. The run
  has no value for it.

## Overall

| | micro P / R / F1 | macro P / R / F1 | tags passing 60/30, 50/50, 60/60, 70/70 |
|---|---|---|---|
| #276 (shipped blend) | .624 / .635 / **.629** | .709 / .629 / **.641** | 33, 31, 22, 10 |
| retrain, its own cutoffs | .628 / .563 / **.594** | .720 / .582 / **.610** | 29, 27, 20, 12 |
| retrain, #276's cutoffs (reference) | .537 / .632 / .581 | .658 / .635 / .610 | 29, 28, 20, 10 |

The last row runs the new weights with the shipped policy's cutoffs as they are. It is only for reference, because those
cutoffs were set on the old model's scores. Files: this folder (own cutoffs) and `same-cutoffs-as-276/`.

## Per tag (F1, own cutoffs; ★ = the 12 weak tags, ▲/▼ = change of .03 or more)

| tag | weak-12 | pos | #276 F1 | new P / R / F1 | Δ F1 | new weights, #276 cutoffs (F1) |
|---|---|---|---|---|---|---|
| drums | ★ | 63 | 0.514 | 0.378 / 0.857 / **0.524** | +0.010 | 0.529 |
| wind ambience | ★ | 20 | 0.392 | 0.556 / 0.250 / **0.345** | -0.047 ▼ | 0.347 |
| cymbal | ★ | 38 | 0.761 | 0.362 / 0.895 / **0.515** | -0.246 ▼ | 0.469 |
| foley | ★ | 20 | 0.258 | 0.235 / 0.400 / **0.296** | +0.038 ▲ | 0.137 |
| hi-hat | ★ | 20 | 0.438 | 0.600 / 0.150 / **0.240** | -0.198 ▼ | 0.286 |
| vocal shout | ★ | 20 | 0.400 | 0.529 / 0.450 / **0.486** | +0.086 ▲ | 0.479 |
| clap | ★ | 21 | 0.370 | 0.714 / 0.238 / **0.357** | -0.013 | 0.357 |
| bell | ★ | 26 | 0.423 | 0.524 / 0.423 / **0.468** | +0.045 ▲ | 0.468 |
| piano | ★ | 20 | 0.423 | 0.556 / 0.750 / **0.638** | +0.215 ▲ | 0.536 |
| snare | ★ | 24 | 0.444 | 0.667 / 0.333 / **0.444** | +0.000 | 0.444 |
| machine ambience | ★ | 20 | 0.474 | 0.579 / 0.550 / **0.564** | +0.090 ▲ | 0.458 |
| tambourine | ★ | 15 | 0.476 | 1.000 / 0.267 / **0.421** | -0.055 ▼ | 0.476 |
| accordion |  | 19 | 0.900 | 0.857 / 0.947 / **0.900** | +0.000 | 0.900 |
| acoustic guitar |  | 20 | 0.857 | 1.000 / 0.750 / **0.857** | +0.000 | 0.857 |
| animal sound |  | 31 | 0.577 | 0.800 / 0.258 / **0.390** | -0.187 ▼ | 0.491 |
| bass guitar |  | 20 | 0.595 | 0.647 / 0.550 / **0.595** | +0.000 | 0.579 |
| bird ambience |  | 20 | 0.516 | 0.556 / 0.250 / **0.345** | -0.171 ▼ | 0.537 |
| breath |  | 21 | 0.632 | 0.727 / 0.381 / **0.500** | -0.132 ▼ | 0.615 |
| cowbell |  | 20 | 0.857 | 1.000 / 0.750 / **0.857** | +0.000 | 0.857 |
| crash cymbal |  | 19 | 0.667 | 0.909 / 0.526 / **0.667** | +0.000 | 0.722 |
| crowd ambience |  | 20 | 0.737 | 0.778 / 0.700 / **0.737** | +0.000 | 0.737 |
| electric guitar |  | 20 | 0.722 | 0.812 / 0.650 / **0.722** | +0.000 | 0.722 |
| environmental sound |  | 46 | 0.741 | 0.955 / 0.457 / **0.618** | -0.123 ▼ | 0.709 |
| finger snap |  | 20 | 0.788 | 0.933 / 0.700 / **0.800** | +0.012 | 0.833 |
| glockenspiel |  | 20 | 0.645 | 0.933 / 0.700 / **0.800** | +0.155 ▲ | 0.600 |
| gong |  | 20 | 0.778 | 0.737 / 0.700 / **0.718** | -0.060 ▼ | 0.718 |
| guitar |  | 59 | 0.767 | 0.846 / 0.746 / **0.793** | +0.026 | 0.764 |
| harmonica |  | 20 | 0.760 | 0.633 / 0.950 / **0.760** | +0.000 | 0.760 |
| harp |  | 20 | 0.727 | 0.923 / 0.600 / **0.727** | +0.000 | 0.727 |
| kick |  | 21 | 0.622 | 0.500 / 0.048 / **0.087** | -0.535 ▼ | 0.345 |
| mallet instrument |  | 22 | 0.723 | 0.680 / 0.773 / **0.723** | +0.000 | 0.723 |
| organ |  | 19 | 0.625 | 0.769 / 0.526 / **0.625** | +0.000 | 0.625 |
| percussion |  | 115 | 0.778 | 0.932 / 0.357 / **0.516** | -0.262 ▼ | 0.712 |
| rain ambience |  | 20 | 0.711 | 0.652 / 0.750 / **0.698** | -0.013 | 0.698 |
| siren |  | 20 | 0.727 | 0.640 / 0.800 / **0.711** | -0.016 | 0.651 |
| spoken phrase |  | 34 | 0.500 | 0.722 / 0.382 / **0.500** | +0.000 | 0.500 |
| strings |  | 20 | 0.611 | 0.688 / 0.550 / **0.611** | +0.000 | 0.611 |
| tabla |  | 6 | 1.000 | 1.000 / 1.000 / **1.000** | +0.000 | 1.000 |
| trumpet |  | 20 | 0.889 | 0.944 / 0.850 / **0.895** | +0.006 | 0.889 |
| vinyl scratch |  | 20 | 0.821 | 1.000 / 0.850 / **0.919** | +0.098 ▲ | 0.430 |
| vocal laugh |  | 20 | 0.718 | 0.737 / 0.700 / **0.718** | +0.000 | 0.718 |
| vocal scream |  | 20 | 0.750 | 0.812 / 0.650 / **0.722** | -0.028 | 0.667 |
| voice |  | 99 | 0.531 | 0.511 / 0.465 / **0.487** | -0.044 ▼ | 0.545 |
| water ambience |  | 20 | 0.500 | 0.351 / 0.650 / **0.456** | -0.044 ▼ | 0.533 |
| whisper |  | 20 | 0.625 | 0.500 / 0.650 / **0.565** | -0.060 ▼ | 0.565 |
| whoosh |  | 20 | 0.727 | 0.923 / 0.600 / **0.727** | +0.000 | 0.727 |

**Up .03 or more (7):** piano +.215, glockenspiel +.155, vinyl scratch +.098, machine ambience +.090, vocal shout +.086,
bell +.045, foley +.038.

**Down .03 or more (14):** kick −.535, percussion −.262, cymbal −.246, hi-hat −.198, animal sound −.187, bird ambience
−.171, breath −.132, environmental sound −.123, gong −.060, whisper −.060, tambourine −.055, wind ambience −.047,
voice −.044, water ambience −.044.

Drums barely moves (.514 to .524). The new drums cutoff (0.366) is higher, so recall drops (.889 to .857) and precision
rises a little (.361 to .378). Most of the drops come from recall falling at the run's own validation cutoffs (kick
.048, percussion .357, hi-hat .15). With #276's cutoffs, cymbal (.469) and kick (.345) are still well below the shipped
numbers, so the problem is the scores themselves and not only the cutoffs.

## Verdict

Do not ship this run as it is. Micro F1 drops from .629 to .594, macro from .641 to .610, and 14 tags drop by .03 or
more, while 7 improve. It should only be used through `combine.py` (`tagger-combine.yml`), which takes a tag from a new
run only where it wins on held-out sets: for example piano, glockenspiel, machine ambience, vocal shout and bell. Any
combine job or ship needs Chris's OK.
