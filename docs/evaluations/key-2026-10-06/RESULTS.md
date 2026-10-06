# Key detection: learned key profiles (2026-10-06)

**Problem.** Round 2 of the DJ clip test ([PR #119](https://github.com/chrisatom1998/document-graph-explorer/pull/119))
found the app's key exactly right on only 46% of 395 Beatport tracks, and the main error was minor tracks called major
(59 of 74 parallel-key errors). 69% of those tracks are minor, but the app said major on 53% of the keys it showed.

**Cause.** The app used Essentia's `KeyExtractor` with its default `bgate` profile, which leans major on EDM. Essentia's
EDM profile `edma` is worse here, not better (46% → 41% on the same 395 tracks).

**Fix.** `src/audio/key.ts` now scores the 24 keys with profiles learned from labelled audio: a 36-bin mean chroma
(Essentia HPCP, a third of a semitone per bin) is log-compressed, centred and scaled, and each key's score is its mode's
36 weights against the chroma rotated to that tonic. A softmax over the 24 keys must reach 0.25 for a key to be shown
(about the same share of tracks as before); strength maps that floor to 0.6, so 0.6 still marks the weakest key shown and
every place that reads `strength >= 0.6` keeps its meaning. The excerpt gates (single repeated pitch, too few pitch
classes, under 3 s) and the half-of-excerpts vote for long recordings are unchanged. Tempo and tags are untouched.
`KEY_ANALYSIS_REVISION` goes to 3 so existing libraries re-estimate keys.

## Data

| Set | Use | Rows | Truth |
|---|---|---|---|
| tune-mtg | tuning | 392 GiantSteps MTG key tracks × 10 s at 25/50/75% | Manual key, annotator confidence 2 |
| tune-gtzan | tuning | 415 GTZAN clips (30 s), seeded half | Lerch's GTZAN key annotations |
| mtg-500 | judging only | Round 2's 395 confident-key tracks, the same middle 10 s | as tune-mtg |
| gs-key | judging only | Original GiantSteps key set: 430 tracks, middle 10 s and whole preview | GiantSteps key annotations |
| test-gtzan | judging only | The other 422 GTZAN clips | as tune-gtzan |

The recorded run fetched audio from the JKU backup only; 174 of the 604 GiantSteps key tracks were not served there, so
gs-key has 430. The harness now also tries Beatport's preview URL and lists any track no source serves
(`unavailable.json`) instead of dropping it silently. The MTG key tracks reserved for round 3 (the fresh audio test set thread's rule) were never fetched. Features:
`.github/workflows/key-features.yml` → `features/*.json.gz` (no audio). Model choice: track-grouped 5-fold
cross-validation on the tuning sets only (`cv.txt`; 36 variants: 12 vs 36 bins, bass chroma, compression, L2).

## Before / after (offline, the app's exact key code run in Node on the same excerpts; `score.txt`)

Exact = right tonic and mode, over all labelled tracks (no key shown counts as wrong). MIREX = weighted score
(fifth 0.5, relative 0.3, parallel 0.2).

| Held-out set | n | Exact before → after | MIREX before → after | Minor called major | Shown |
|---|---|---|---|---|---|
| Round 2's 500 (confident key) | 395 | 46.1% → **54.4%** | 0.56 → 0.64 | 59 → 11 | 94% → 95% |
| GiantSteps key, 10 s | 430 | 46.7% → **56.0%** | 0.56 → 0.63 | 32 → 8 | 94% → 96% |
| GiantSteps key, whole preview | 430 | 50.2% → **60.2%** | 0.58 → 0.66 | 28 → 3 | 87% → 88% |
| GTZAN (other half) | 422 | 61.6% → **65.4%** | 0.69 → 0.72 | 32 → 13 | 95% → 95% |

The offline "before" on round 2's 500 (46.1%, MIREX 0.564) matches round 2's in-browser result exactly, so the
harness reproduces the app. On GTZAN genres exact rises 8–12 points on blues, hip-hop, jazz and metal, is flat on pop,
rock and country, and falls 6 on reggae (51 clips). On the 500 Beatport tracks it gains most on psy-trance, trance, techno,
breaks and hard dance; house, tech-house and progressive house lose a few tracks each (each genre has 19–26 tracks).
The model now leans minor: about a quarter of shown EDM keys are major (the sets are 70–85% minor), and the remaining
parallel errors are mostly major tracks called minor.

Errors that remain are mostly tonic errors (fifths and unrelated keys), which a profile alone cannot fix.

## Browser check on round 2's 500

The built app in headless Chromium (`.github/workflows/key-fix-browser.yml`, run 37415134127; `browser/mtg-key.txt`):
key exact **54.4%** (was 46.1%), MIREX 0.64 (was 0.56), shown 376 of 395, matching the offline numbers exactly. Tempo
(84.2% within 4%) and every tag count are identical to main with #116. Chris's 16 SHADOW_UK1 melodic loops: 5/16
exact before and after (the same five loops).

## Round 2: the learned key network (PR #140)

**Change.** Songs now get their key from the small key network the "More models to train on Hugging Face" thread
trained (236 KB ONNX, all-convolutional after Korzeniowski & Widmer 2018; trained on the same tuning tracks as above,
GiantSteps MTG key at annotator confidence 1-2 and the GTZAN tuning half, with pitch-shift augmentation; never on any
set below). `src/audio/keyCnn.ts` computes its input at 44.1 kHz on the same time/frequency grid as its 22.05 kHz
training features (max difference 2e-5 against the trainer's `feats.py`), runs it on each excerpt that passes the
existing tonal gates, and averages the probabilities over the recording. For files shorter than 9.5 s Essentia's
stock key profile decides when it gives a key, because it reads short loops better (below). If the network cannot
load, the profiles from round 1 are used. `KEY_ANALYSIS_REVISION` is 4.

| Held-out set | n | Before #123 | #123 (main) | **This PR** |
|---|---|---|---|---|
| Round 2's 500 (confident key), 10 s | 395 | 46.1% | 54.4% | **55.2%** |
| GiantSteps key, 10 s | 430 | 46.7% | 56.0% | **57.7%** |
| GiantSteps key, whole preview (app plan) | 430 | 50.2% | 60.2% | **67.0%** |
| GTZAN test half, 30 s | 422 | 61.6% | 65.4% | **73.9%** |
| 473 drumless FSL10K loops (listener keys) | 473 | 67.9% | 61.1% | **62.4%** |
| Chris's 16 SHADOW_UK1 loops | 16 | 5 | 5 | **5** |

Exact key, offline harness (`features-v2/`, `loops/fsl10k-473.json`). Browser check of the built app on round 2's 500
(`browser-cnn/mtg-key.txt`, run on the network without the loop rule, which does not touch 10 s clips): **54.9%**
exact, MIREX 0.65, 392 of 395 shown, one track off the offline number; tempo 84.2% and every tag count identical.

**Loops.** On short drumless loops the network alone is the worst of the three (55.8%); Essentia's stock profile is
best (67.9%). A blend for every recording cost songs about 3 points, and neither the profile's strength nor the
network's certainty separates loops from songs, so the stock profile only decides files under 9.5 s. Weight and
cut-off were chosen on one half of the loops and one half of GiantSteps key (`scripts/key/blend.py`, `blend.txt`);
on the other half of the loops it gives 60.4% (network 56.7%, #123 62.1%, stock profile 65.8%). Loops of 10-30 s
stay with the network, so loops remain about a point below #123 and six below the stock profile.

The FSL10K loops are 473 sounds from FSL10K (Zenodo 3967852) where every listener agreed on key and mode and nobody
ticked percussion; `scripts/key/loop-keys.mjs` reads each as the app does (one excerpt, whole file up to 60 s).
