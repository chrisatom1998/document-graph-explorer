# Local DJ classifier training

`scripts/train-dj-classifier.mjs` trains small binary classifiers on frozen, normalized CLAP audio features for labels with both positive and negative examples. Labels without positive examples are omitted. These are independent scores, so training does not assume every recording has only one sound. This is supervised training of new weights, not another set of text prompts and not full CLAP fine-tuning.

The first dataset adapter is deliberately specific to the owner's Shadow UK Bass Vol 1 pack. It uses the owner's confirmation that the melodic files are synthesizers and explicit Vocal/VOX or breath filenames. Generic CHOP filenames and unnamed files are excluded from vocal training: chops describe an editing technique, not a sound source. Other vocal production types remain unknown. Bass files have no inferred training labels. Do not apply this adapter to an arbitrary pack or treat filename-derived labels as independently audited ground truth.

## Run

Requires the project's installed dependencies and bundled sound model, plus `ffmpeg` and `ffprobe` on PATH. `FFMPEG_PATH` and `FFPROBE_PATH` can override executable locations.

```sh
node scripts/train-dj-classifier.mjs \
  '/Users/chrisjohnson/Documents/Media/Shadow UK Bass Vol 1 Samples' \
  artifacts/music-evaluation/dj-training-shadow
```

Audio remains local and is not copied to the application. The output directory is ignored by Git and is outside `public/`, so the samples, feature cache and candidate weights are not included in website or desktop builds. Existing app inference is unaffected. The trainer does not deploy its result or claim that saved UI corrections retrain models automatically.

The run writes an inventory, feature cache, training set with label provenance, candidate weights, per-file evaluation, fitted predictions and a readable `REPORT.md`. Fitted predictions are diagnostic only; they are not accuracy estimates.

## Validation and reproducibility

- Features use the bundled quantized music/speech CLAP encoder with 48 kHz mono audio, ten-second windows at five-second intervals, and the final tail. Window embeddings are normalized before pooling; the pooled embedding is normalized again.
- Local model and preprocessor hashes must match the manifest. Cached features are keyed by audio bytes and extraction configuration. A changed filename can change labels, but never the features used to predict them.
- Training is deterministic, class-balanced logistic regression with fixed L2 regularization. Unknown targets are masked separately for each head rather than being treated as negative examples.
- Evaluation leaves entire sample families out. Numbered variants, identical bytes, and embeddings with at least 0.98 cosine similarity are grouped. When a fold has no remaining positive or negative training examples, that fold is marked unavailable rather than counted as correct.
- Synthetic white noise is a separate negative check, never used for fitting or threshold selection. Scores are uncalibrated; 0.5 is the fixed diagnostic cutoff, not a production acceptance threshold.

## First run: release decision

The initial 31-clip candidate included an incorrect assumption that generic chops were vocal chops. Following the owner's correction, the generic CHOP files and unnamed sample are excluded from vocal training. No positive vocal-chop examples remain, so the retrained candidate omits that head. Seven non-hidden bass-loop files contain no WAV audio payload; the readable bass shot remains unreviewed. The current counts and results are in the regenerated report. No independent test pack is available, and the initial candidate failed the white-noise control.

**The candidate is not deployed.** Add independently reviewed examples from other packs, especially confusing negatives (noise, drums, breathy synths, chopped instruments) and real mixtures. Reserve complete packs for final testing before tuning thresholds or comparing against the existing ensemble. The small current dataset does not establish a general accuracy improvement.
