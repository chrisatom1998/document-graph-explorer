# Learned tempo model next to the beat tracker (2026-10-06)

After #116 the app's tempo was within 4% of the labelled BPM on 71.6% of round 1's 500 Beatport clips. Most of the
remaining misses were half-time drum & bass and triplet-feel readings (93 for a 140 track, 172 for a 129 track): dotted
basslines and riffs fool the onset-based beat tracker. This change adds a small learned tempo classifier and lets it
override the beat tracker only when it confidently reads a different tempo.

## The model

`public/tempo-model/tempo-cnn.onnx` (1.4 MB) is a convolutional tempo classifier after Schreiber & Müller (2018),
trained by the "More models to train on Hugging Face" thread. The training scripts are in `model/`. Input is 10 s
windows of 40 log mel bands at 11025 Hz (hop 512), and output is 256 tempo classes from 30 to 285 BPM. It was trained
only on the tempo tuning clips: the 161 GiantSteps tempo tracks outside round 1, 293 GiantSteps MTG key tracks outside
round 2 and outside the round 3 reserve, and the tuning half of GTZAN. Training used time-stretch augmentation.

`src/audio/tempoCnn.ts` computes the same features in the browser. On three synthetic test tracks, the browser's mel
frames differ from `model/feats.py` by at most 0.04 (mean 0.0008, on values up to 8), and both give identical top-3 tempo
classes. The CNN averages its softmax over every 10 s window of the tempo excerpts (three 20 s excerpts for recordings
over a minute, otherwise the first 60 s).

## The override rule

The app keeps its beat-tracker tempo (after #116's half-time correction) unless the CNN's tempo differs by more than 4%
**and** the CNN's confidence is above 0.5. Confidence is the softmax mass of its top three classes that lie within 4% of
its tempo. The CNN's tempo must also lie in the app's 40-250 BPM range, and an overriding tempo carries the CNN's
confidence. Recordings shorter than 8 s keep the loop estimator's tempo and alternatives.

The threshold was chosen on tuning clips only, with out-of-fold readings from both methods
(`scripts/tempo/cnn-combine.py`, output in `combine-output.txt`). 0.4 scored slightly higher overall, but it lost 1 point
on full-length GTZAN songs. 0.5 was the lowest threshold that left non-dance music unchanged:

| Tuning clips (out of fold) | n | App | App + CNN at 0.5 |
|---|---|---|---|
| GiantSteps, 10 s | 322 | 74.5% | 82.9% |
| GiantSteps, 20 s | 140 | 81.4% | 87.1% |
| GTZAN, 10 s | 500 | 70.2% | 71.0% |
| GTZAN, 30 s | 407 | 80.1% | 79.9% |

## Held-out results (scored once, after the rule was fixed)

The app column is the browser tempo after #116, and the CNN column uses the final model.

| Set | n | App | App + CNN | Fixed | Broken |
|---|---|---|---|---|---|
| **Round 1, 500 Beatport clips** | 500 | 71.6% | **82.4%** | 60 | 6 |
| Round 2, 500 Beatport clips (Beatport BPM) | 497 | 84.7% | 86.5% | 14 | 5 |
| GTZAN test half, middle 10 s | 498 | 68.7% | 69.9% | 12 | 6 |
| GTZAN test half, 30 s | 498 | 63.5% | 63.9% | 6 | 4 |

Round 1 by genre (70% target):

| Genre | n | App | App + CNN |
|---|---|---|---|
| drum & bass | 104 | 59.6% | 75.0% |
| dubstep | 57 | 64.9% | 77.2% |
| trance | 55 | 78.2% | 96.4% |
| techno | 43 | 81.4% | 93.0% |
| electronica | 37 | 59.5% | 75.7% |
| psy-trance | 24 | 83.3% | 95.8% |
| deep house | 21 | 85.7% | 85.7% |
| house | 21 | 81.0% | 85.7% |
| electro house | 19 | 89.5% | 89.5% |
| breaks | 18 | 77.8% | 88.9% |
| progressive house | 15 | 86.7% | 93.3% |
| glitch hop | 15 | 66.7% | 80.0% |

Every round 1 genre with at least 15 clips now clears 70%. In round 2, every genre except drum & bass is at 80% or
better. Drum & bass falls from 27% to 20%, because Beatport lists most of those tracks at half tempo (about 87) and
the CNN reads the full 174. Triplet-feel errors on round 1 fall from 47 to 22 (two-thirds time from 28 to 11).

On GTZAN, every genre is unchanged or better except pop: 84% to 80% on 10 s clips and 82% to 80% on full songs, 2 and
1 clips respectively. Classical and jazz stay far below 70%, as before. Neither has a steady beat that either method
reads reliably.

The held-out app and CNN readings come from the model thread's harness (`model/tempo-heldout.json.gz`).
`.github/workflows/tempo-cnn-browser.yml` re-runs both 500-clip rounds through the built app, and its reports land in
`browser/`.
