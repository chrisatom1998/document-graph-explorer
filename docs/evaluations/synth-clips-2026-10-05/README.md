# Synth one-shot heads: retrain and fresh test (2026-10-05)

Fresh frozen test (`manifest.json`, SHA-256 `426f10ceaf97ce1d…`), pre-registered in `PREREGISTRATION.md`, measured once
through real uploads of the built app (`artifacts/short-clips/dist-synth`). Sounds-panel check: 10/10 identical.
2,023 clips, 466 families: held-out NSynth-train instruments (synthetic = synthesizer; acoustic = not) and held-out
FSD50K dev uploaders (drums, voices, impacts… = not a synthesizer).

Training: looped-CLAP logistic heads (same inputs/standardisation as the other one-shot heads) on FSD50K dev + Surge
renders + 4,179 NSynth-train notes, with every clip known not to be a synthesizer also labelled "not a synth hit"
(the gap that made the first synth heads fire on drums and voices). Test families excluded from training.

| Head | Precision (95% family CI) | Recall (95% family CI) | TP / FP / FN | Pass bar 60/60 | Decision |
|---|---|---|---|---|---|
| synth hit | 0.84 (0.75–0.91) | 0.87 (0.79–0.94) | 153 / 30 / 23 | yes | **shipped** |
| synthesizer (source) | 0.80 (0.68–0.89) | 0.48 (0.39–0.57) | 105 / 27 / 115 | no (recall) | **stays hidden** |

Development (out-of-fold) numbers were 0.95 / 0.93 and 0.95 / 0.95 — again higher than test, so test decides.
With the synthesizer head hidden, a synthesizer source tag only appears when the app copies it from a shown synth-hit
tag and no other synthesizer tag exists; in this run that happened on 1 clip.
