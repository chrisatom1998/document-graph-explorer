# Hugging Face Hub models for instrument tags: Demucs stems, MERT, low-pass (2026-10-06)

**Question:** do ready-made Hub models give the full-mix instrument heads (PR #134) better evidence for the tags that
still miss 70/70 on the DJ clip rounds (bass, organ, trumpet), or for voice?

**Answer: no.** Neither Demucs stems nor MERT-v1-95M improved any of those tags, on the training set or on the judge
rounds. Nothing here changes the app.

## Method

- Features came from `scripts/hub-models/stem_features.py`, which ran as a Hugging Face Jobs L4 job (6ac4c75e,
  about 2 h, about $1.67). It covered 8,936 OpenMIC-2018 split01_train clips, chosen in a fixed random order from the
  14,912 that the shipped heads used (benchmark artists removed), plus the 1,000 DJ round 1 and 2 clips.
- Each clip got the CLAP embedding (laion/larger_clap_music_and_speech) and the AST AudioSet logits for the mix, for the
  Demucs htdemucs bass, other and vocals stems, and for a 150 Hz low-pass of the mix. It also got each stem's level
  relative to the mix, and MERT-v1-95M mean-pooled hidden states.
- The models ran in fp32 PyTorch, not the app's q8 ONNX. So the baseline is a same-pipeline mix-only head, not the
  shipped heads (which also use Jamendo activations).
- `scripts/hub-models/heads.py` fitted each head with `scripts/full-mix-heads/train.py`'s own rules: artist folds,
  balanced logistic regression, and the threshold at 80% out-of-fold precision at 25% prevalence. Everything was fitted
  and chosen on train only, and that includes the MERT layer (layer 6, picked by train out-of-fold AP).
- Rounds 1 and 2 were scored once, with frozen heads (CPU job 6ac4e6ba). No number below was tuned on them.
- Features are in the private dataset `cmjatom/dge-hub-models` under `stems-v1/`, together with `heads-report.json`.

## Train out-of-fold average precision (8,936 clips, artist folds)

| Tag | mix (baseline) | + Demucs stems | + low-pass | + MERT |
|---|---|---|---|---|
| bass | 0.755 | 0.703 | 0.734 | 0.762 |
| organ | 0.850 | 0.825 | 0.834 | 0.843 |
| trumpet | 0.880 | 0.878 | 0.878 | 0.881 |
| voice | 0.997 | 0.997 | 0.996 | 0.997 |
| mean of 11 tags | 0.935 | 0.926 | 0.930 | 0.935 |

## Judge rounds, head alone (precision / recall, scored once)

| Tag | Round 1 mix | R1 + stems | R1 + MERT | Round 2 mix | R2 + stems | R2 + MERT |
|---|---|---|---|---|---|---|
| bass (9 / 15 positives) | 0.67 / 0.44 | 0.75 / 0.33 | 0.67 / 0.44 | 0.86 / 0.40 | 1.00 / 0.07 | 0.83 / 0.33 |
| organ (19 / 16) | 0.89 / 0.42 | 0.86 / 0.32 | 0.73 / 0.42 | 0.67 / 0.25 | 0.44 / 0.25 | 0.25 / 0.06 |
| trumpet (17 / 18) | 0.85 / 0.65 | 0.85 / 0.65 | 0.85 / 0.65 | 0.83 / 0.56 | 0.82 / 0.50 | 0.83 / 0.56 |
| voice (24 / 31) | 0.92 / 0.96 | 0.92 / 0.96 | 0.92 / 0.96 | 0.97 / 0.94 | 1.00 / 0.90 | 0.97 / 0.97 |

For comparison, the app on main (#134 heads plus the other evidence) scores bass 0.50 / 0.56 (round 1, real app) and
0.73 / 0.53 (round 2, simulation), organ 0.62 / 0.95 and 0.48 / 0.88, trumpet 0.62 / 0.77 and 0.50 / 0.89, and voice
0.89 / 1.00 and 0.88 / 0.90.

## What this means

- **Stems hurt slightly.** They added about 2,000 features that the heads could not use with 9k training clips. Bass
  average precision fell from 0.755 to 0.703. The real limit is the labels: OpenMIC's "bass" covers bass guitar and
  double bass but not the synth bass that every DJ track has, so a cleaner bass signal does not fix it.
- **MERT matches CLAP + AST and adds nothing on top.** MERT-v1 weights are also CC BY-NC 4.0, so they could not ship in
  the app anyway.
- **Voice already passes.** The vocals stem did not move it. Voice's known problem is false voice tags on short
  instrumental loops (#136), not full mixes. Whisper was not tried.
- **Browser cost, if stems were ever wanted.** The htdemucs ONNX export (timcsy/demucs-web-onnx) is 180 MB fp32. It
  took about 10 s per 7.8 s segment on 4 native CPU threads (23 s on 1 thread), so WASM would take roughly 10-20
  minutes per DJ track for the whole song. It would only work as an optional step on a few windows.
