# DGE's own instrument tagger

Fine-tunes an AudioSet-pretrained EfficientAT MobileNet (`mn10_as`, MIT, 4.2M parameters) to tag the 20 OpenMIC
instrument classes the fusion pipeline already uses, and exports it as one ONNX file (log-mel front end inside the
graph) that onnxruntime-web can run on 10 s windows of 32 kHz audio.

| Step | Script | Data |
|---|---|---|
| OpenMIC train clips | `prepare.py` | OpenMIC-2018 split01_train minus every artist in a DGE benchmark (14,912 clips, 5,118 artists) |
| Jamendo train windows | `prepare-jamendo.py` | MTG-Jamendo split-0 train + validation, two 10 s windows per track (~39,700 windows); split-0 test and the round 3 held-out artists are never read |
| Round 3 held-out audio | `prepare-holdout.py` | The 500 tracks of PR #121's manifest, for judging only |
| Train | `train.py` | ~10% of artists per source held out as validation |
| Thresholds | `calibrate.py` | Validation artists only: per tag, maximise min(precision, recall) |
| Export | `export.py` | Checks the ONNX output against PyTorch before writing |
| Score | `evaluate.py` | DJ clip rounds 1 and 2 and the round 3 set, aggregates only, counted like the app's scorers |
| Browser parity | `parity.py` | A fixed synthetic signal cut and scored as the held-out scorers did; `src/audio/tagger.parity.test.ts` checks the app's front end against it |
| Combine runs | `combine.py` | Per app tag, the run with the best held-out mean min(P, R), never one that drops a set the shipped run passes; one ONNX file with a shared front end (`tagger-combine.yml` builds, scores and publishes it) |

`.github/workflows/audio-model-train.yml` runs the whole chain on a Hugging Face Jobs GPU (`hf-job.sh`, launched by
`hf-launch.py`) with the `HF_TOKEN` repository secret, and uploads the run to that account's private
`dge-instrument-tagger` model repo.

The app runs a blend of runs 3 and 5 (each tag in `src/audio/taggerPolicy.json` from the run listed in
`public/tagger-model/model.json`'s `outputRun`); see docs/evaluations/all-tags-blend-2026-10-09.
