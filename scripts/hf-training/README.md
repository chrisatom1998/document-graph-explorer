# Learned key and tempo models (2026-10-06)

Scripts behind the key CNN and tempo CNN trained for DGE. Weights and per-clip held-out results live in the private
HF dataset `cmjatom/dge-key-tempo-train` (pulled into `docs/evaluations/hf-key-tempo-2026-10-06/runs/` by
`.github/workflows/hf-model-pull.yml`). Audio is never committed.

- `feats.py`: browser-reproducible key (144 quarter-tone bins, 5 fps) and tempo (40 mel, 21.5 fps) features.
- `build_labels.py`, `job.py`: tempo-v1 HF Jobs run (free GiantSteps/MTG tracks + GTZAN tune half).
- `job_loops.py`: tempo-loops-v1, adds FSL10K loops with uploader BPMs; every listener-annotated FSL10K loop is excluded.
- `train_key.py`, `train_tempo.py`: models; `eval_heldout.py`, `tempo_oof.py`: one-time held-out scoring and out-of-fold predictions.
- `export_key.py`, `export_tempo.py`: ONNX export for onnxruntime-web.

Held-out sets (never trained on): GiantSteps key, round 1 and round 2 DJ clips, round 3, GTZAN test half, FSL10K annotated loops.
