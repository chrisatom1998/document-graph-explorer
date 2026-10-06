# Short clips (0.3–2.25 s): audit, benchmark and one-shot detectors

Scope: DJ one-shots and other 1–2 s clips, measured through real uploads into the built app.
Every number below is what the **Sounds panel displayed** (tags with a score ≥ 0.50, "maybe" tags included), computed by
the app's own `confidentSoundSummary` + `filenameSoundFallback` on DGE's graph export, and spot-checked against the
rendered panel: 15/15 identical in the after-v1 and v2 test runs, 4/4 in a baseline calibration smoke run (the baseline test run had no on-screen check). A 0.50 score is a detector threshold, not 50% accuracy.

## 1. Audit: what happened to a short clip before this change

| Stage | Behaviour for a 1–2 s clip |
|---|---|
| Jamendo (MTG) instrument model | Explicitly **unsupported** under 2.048 s (`analyzeDecodedMusic.ts`); recorded as `unsupportedReason`, no inference. |
| Trained fusion detector | Unsupported: it needs all three models plus the 10 s Ogg tier, so short clips never get it. |
| CLAP sound model | Always takes 10 s. Its preprocessor **repeats the clip to fill 10 s** (`padding: repeatpad`), so a 1 s kick reaches the model as ten kicks. |
| CLAP trained heads (`learned.json`) | Trained on longer audio. On one-shots they produced loop tags (e.g. "drum loop" on a 1.4 s hit) and false cymbals (precision 0.18). |
| AST (AudioSet) | Pads its own spectrogram to 1024 frames; scores are kept but are not a displayed (tested) source. |
| Tempo | Needs ≥ 2 s and ≥ 3 attacks; otherwise abstains. |
| Key | Needs ≥ 3 s and pitch diversity; a single note never gets a major/minor key. |
| Pitch of a single note | Needed ≥ 1.5 s, so every 1 s note abstained. |
| Filename fallback | Separate "name" tags; benchmark clips use opaque names (`sc-<hash>.wav`) so it never fires. |

## 2. Benchmark (frozen before any tuning)

`manifest.json` (SHA-256 `80bac01368ca6cff…`), built by `scripts/build-short-clip-bench.py`. Test split: **1,445 clips, 614 independent families**.

| Source | Licence | Labels | Test families |
|---|---|---|---|
| FSD50K eval split, natural 0.3–2.25 s clips, audio unchanged | per-clip CC (dataset CC BY 4.0) | human-verified AudioSet labels | uploaders (disjoint from FSD50K dev; 44 uploaders used in earlier DGE training excluded) |
| NSynth test notes, first 1.0 or 2.0 s, 10 ms fade | CC BY 4.0 | instrument family/source, MIDI pitch, quality tags from metadata | instruments |
| AVP vocal percussion, one cropped utterance per annotated onset | CC BY 4.0 | voice/beatbox present; imitated kick/snare/hat left **unknown** | participants |

- Dimensions kept separate: `source:` (what makes the sound), `role:` (kick, snare, impact…), `effect:` (distorted, reverberant), `musical:` (key, tempo).
- A label no source states is **unknown**, never absent. Confusers (doors, glass, gunshots, animals…) are kept as negatives. Quiet clips (peak < −20 dBFS) are a reported slice.
- Families never cross splits (validator-checked; it caught an NSynth valid/test instrument overlap, fixed before use).
- `reserved-test-families.json` lists every test recording and family. **Never train on them.**

## 3. Experiments (development data only)

Selection used uploader/preset/participant-grouped 5-fold out-of-fold predictions over train + calibration (FSD50K dev,
AVP, and 2,548 Surge preset notes for synth/bass training only). The test split was never read. Full table: `artifacts/short-clips/feature-comparison.json`.

| Input to per-category logistic heads | Categories passing 70/70 | Mean F1 |
|---|---|---|
| CLAP, clip **repeated** to 10 s (app's existing fingerprint) | **23/26** | **0.868** |
| CLAP, clip + silence to 10 s (closest to "unchanged"; CLAP cannot take shorter input) | 21/26 | 0.831 |
| Attack/body/decay event features alone (`src/audio/eventFeatures.ts`) | 2/26 | 0.428 |
| AST AudioSet logits alone | 17/26 | 0.724 |
| Repeated CLAP + event features | 23/26 | 0.868 |
| Repeated CLAP + AST + event | 21/26 | 0.846 |

Finding: repetition is not what misled the old detectors; heads trained on **long** audio were. Heads trained on short
clips read the repeated fingerprint better than the silence-padded one, and loop tags on one-shots dropped to zero
(below). Extra inputs overfit at this data size, so the shipped model uses the existing fingerprint: **no extra model run**.
Development numbers for `synth hit` and `synthesizer` (≈0.99) were inflated: Surge renders are easy to tell from Freesound clips.

## 4. What changed in the app

- `public/sound-model/short-clip.json` (pinned in `manifest.json`): 20 one-shot heads that reached 70/70 on development
  data. Applied only to clips ≤ 2.25 s (the measured range), inside the existing CLAP request — `src/audio/shortClipModel.ts`, worker `profile` branch.
- On those clips every long-audio CLAP head is hidden (none was validated on one-shots); the user's reviewed examples still apply.
- New generic catalog labels on their own prompt axis, so tags are not more specific than the evidence: `hi-hat`, `cymbal`, `synth hit`, `bass hit`.
- Single-note pitch now works from 0.5 s (denser analysis frames). Still never a key. Development check: 1 s notes 0/22 → 22/22, false pitch on drums/noises 0/260 → 2/260.
- Cache invalidation: the recognition configuration includes the one-shot model hash **only for clips ≤ 2.25 s**, so only those re-run after upgrade; long songs keep their results.
- Display rules unchanged: ≥ 0.50, "maybe" styling, separate filename tags, no Confirm/Reject buttons.

## 5. Results on the frozen test split

Test use is pre-registered in `PREREGISTRATION.md`: after-v1 was the planned result; v2 (policy-only changes decided before
reading after-v1) is the final build. No thresholds or heads were changed after seeing test results.

| Category | Positives / families | baseline P / R | after-v1 P / R | v2 P / R | v2 TP / FP / FN | Meets 70/70 |
|---|---|---|---|---|---|---|
| effect:distorted | 49 / 10 | 0.15 / 0.08 | — / 0.00 | — / 0.00 | 0 / 0 / 49 | no |
| effect:reverberant | 78 / 13 | 0.17 / 0.01 | — / 0.00 | — / 0.00 | 0 / 0 / 78 | no |
| musical:tempo | 0 / 0 | 0.00 / — | 0.00 / — | 0.00 / — | 0 / 1 / 0 | no |
| role:bass hit | 54 / 17 | 0.78 / 0.13 | — / 0.00 | — / 0.00 | 0 / 0 / 54 | no |
| role:beatbox | 111 / 15 | — / 0.00 | — / 0.00 | — / 0.00 | 0 / 0 / 111 | no |
| role:clap | 15 / 9 | — / 0.00 | 0.81 / 0.87 | 0.81 / 0.87 | 13 / 3 / 2 | yes |
| role:cowbell | 21 / 12 | — / 0.00 | 1.00 / 0.57 | 1.00 / 0.57 | 12 / 0 / 9 | no |
| role:cymbal | 11 / 6 | 0.18 / 0.91 | 1.00 / 0.73 | 1.00 / 0.73 | 8 / 0 / 3 | yes |
| role:finger snap | 17 / 16 | 0.79 / 0.88 | 1.00 / 0.71 | 1.00 / 0.71 | 12 / 0 / 5 | yes |
| role:hi-hat | 60 / 37 | 1.00 / 0.87 | 1.00 / 0.87 | 1.00 / 0.87 | 52 / 0 / 8 | yes |
| role:impact | 113 / 68 | — / 0.00 | 0.92 / 0.67 | 0.92 / 0.67 | 76 / 7 / 37 | no |
| role:kick | 33 / 23 | 1.00 / 0.36 | 0.97 / 0.91 | 0.97 / 0.91 | 30 / 1 / 3 | yes |
| role:loop | 0 / 0 | 0.00 / — | — / — | — / — | 0 / 0 / 0 | no |
| role:percussion hit | 231 / 94 | 0.95 / 0.68 | 0.97 / 0.91 | 0.97 / 0.91 | 211 / 6 / 20 | yes |
| role:shaker | 8 / 6 | 0.80 / 1.00 | 0.89 / 1.00 | 0.89 / 1.00 | 8 / 1 / 0 | yes |
| role:snare | 43 / 28 | 0.93 / 0.60 | 0.95 / 0.88 | 0.95 / 0.88 | 38 / 2 / 5 | yes |
| role:synth hit | 36 / 6 | 1.00 / 0.14 | 0.68 / 0.78 | 0.68 / 0.78 | 28 / 13 / 8 | no |
| role:tambourine | 23 / 10 | — / 0.00 | 1.00 / 0.74 | 1.00 / 0.74 | 17 / 0 / 6 | yes |
| role:vinyl scratch | 29 / 19 | 0.84 / 0.55 | 1.00 / 0.83 | 1.00 / 0.83 | 24 / 0 / 5 | yes |
| role:vocal one-shot | 369 / 170 | 0.84 / 0.59 | — / 0.00 | — / 0.00 | 0 / 0 / 369 | no |
| role:whoosh | 54 / 42 | 0.95 / 0.70 | 1.00 / 0.80 | 1.00 / 0.80 | 43 / 0 / 11 | yes |
| source:bass guitar | 12 / 10 | — / 0.00 | 1.00 / 0.50 | 1.00 / 0.50 | 6 / 0 / 6 | no |
| source:brass | 41 / 10 | — / 0.00 | — / 0.00 | — / 0.00 | 0 / 0 / 41 | no |
| source:drums | 212 / 87 | 0.79 / 0.10 | 0.98 / 0.57 | 0.98 / 0.57 | 122 / 2 / 90 | no |
| source:guitar | 70 / 31 | — / 0.00 | 0.70 / 0.70 | 0.70 / 0.70 | 49 / 21 / 21 | yes |
| source:piano | 18 / 4 | — / 0.00 | 0.83 / 0.83 | 0.83 / 0.83 | 15 / 3 / 3 | yes |
| source:synthesizer | 42 / 7 | 0.00 / 0.00 | 0.18 / 0.93 | 0.18 / 0.93 | 39 / 174 / 3 | no |
| source:voice | 369 / 170 | 0.48 / 0.26 | 0.99 / 0.64 | 0.99 / 0.64 | 235 / 2 / 134 | no |

Final-run 95% family-bootstrap intervals (v2):

| Category | Precision | Recall |
|---|---|---|
| effect:distorted | — | 0.00 (0.00–0.00) |
| effect:reverberant | — | 0.00 (0.00–0.00) |
| role:bass hit | — | 0.00 (0.00–0.00) |
| role:beatbox | — | 0.00 (0.00–0.00) |
| role:clap | 0.81 (0.50–1.00) | 0.87 (0.67–1.00) |
| role:cowbell | 1.00 (1.00–1.00) | 0.57 (0.28–0.79) |
| role:cymbal | 1.00 (1.00–1.00) | 0.73 (0.38–0.92) |
| role:finger snap | 1.00 (1.00–1.00) | 0.71 (0.47–0.94) |
| role:hi-hat | 1.00 (1.00–1.00) | 0.87 (0.76–0.95) |
| role:impact | 0.92 (0.85–0.97) | 0.67 (0.56–0.78) |
| role:kick | 0.97 (0.89–1.00) | 0.91 (0.79–1.00) |
| role:percussion hit | 0.97 (0.94–0.99) | 0.91 (0.86–0.95) |
| role:shaker | 0.89 (0.62–1.00) | 1.00 (1.00–1.00) |
| role:snare | 0.95 (0.86–1.00) | 0.88 (0.77–0.97) |
| role:synth hit | 0.68 (0.33–0.94) | 0.78 (0.44–1.00) |
| role:tambourine | 1.00 (1.00–1.00) | 0.74 (0.52–1.00) |
| role:vinyl scratch | 1.00 (1.00–1.00) | 0.83 (0.63–0.97) |
| role:vocal one-shot | — | 0.00 (0.00–0.00) |
| role:whoosh | 1.00 (1.00–1.00) | 0.80 (0.70–0.90) |
| source:bass guitar | 1.00 (1.00–1.00) | 0.50 (0.21–0.90) |
| source:brass | — | 0.00 (0.00–0.00) |
| source:drums | 0.98 (0.95–1.00) | 0.57 (0.46–0.68) |
| source:guitar | 0.70 (0.50–0.91) | 0.70 (0.55–0.86) |
| source:piano | 0.83 (0.50–1.00) | 0.83 (0.57–1.00) |
| source:synthesizer | 0.18 (0.07–0.30) | 0.93 (0.83–1.00) |
| source:voice | 0.99 (0.98–1.00) | 0.64 (0.54–0.74) |

- baseline: 4 categories meet 70/70; clips with no scored tag 633/1445; musical {'keyShown': 0, 'tempoShown': 1, 'singleEvents': 333, 'pitchNotes': 222, 'pitchShown': 98, 'pitchCorrect': 98, 'pitchWrong': 0, 'pitchPrecision': 1.0, 'pitchRecall': 0.441}
- after-v1: 13 categories meet 70/70; clips with no scored tag 477/1445; musical {'keyShown': 0, 'tempoShown': 1, 'singleEvents': 333, 'pitchNotes': 222, 'pitchShown': 198, 'pitchCorrect': 197, 'pitchWrong': 1, 'pitchPrecision': 0.995, 'pitchRecall': 0.887}
- v2: 13 categories meet 70/70; clips with no scored tag 490/1445; musical {'keyShown': 0, 'tempoShown': 1, 'singleEvents': 333, 'pitchNotes': 222, 'pitchShown': 198, 'pitchCorrect': 197, 'pitchWrong': 1, 'pitchPrecision': 0.995, 'pitchRecall': 0.887}

Key results (v2, final): **13 of 27 measurable categories meet ≥70% precision and ≥70% recall (baseline: 4).** v2 matched
after-v1 in every category; 13 more clips show no scored tag in v2 (490 vs 477) because unvalidated long-audio heads
(e.g. tom, sound effect) are hidden on short clips. Loop-type false tags on one-shots: 2 (baseline) → 0. False cymbals: 46 → 0.
Sounds-panel check: 15/15 clips identical to the computed tags in after-v1 and v2.

**Merge check.** All measured builds predate the 2026-10-05 merge of `origin/main` (commit `b26b1fe`). On 240 calibration
clips the merged build showed identical tags to the measured v2 build on 237; the other 3 each gained one tag
(`sound effect` next to `impact` twice, plus one extra `impact` and one extra `hi-hat`). The test numbers above describe
the pre-merge v2 build; expect the merged build to differ on roughly 1% of clips.

Slices (pooled recall over present labels, v2 vs baseline): ≤1.0 s 0.44 vs 0.26; 1.0–2.25 s 0.55 vs 0.40;
quiet clips 0.17 vs 0.17 (no gain); AVP vocal imitations 0.015 vs 0.03.

Musical: 0 keys shown on 333 single events in every build; 1 tempo shown on a single event in every build (unchanged);
single-note pitch on NSynth: shown 98 → 198 of 222, correct 98 → 197 (1 wrong).


### Adjusted after seeing test results (2026-10-05)

The `synth hit` and `synthesizer` one-shot heads were **removed** at the user's request because of the false tags
described below. Re-scoring the v2 run with those tags dropped (offline, exact for removals): still 13 categories meet
70/70; synthesizer and synth hit now abstain (0 false tags, all 42 / 36 positives missed); clips with no scored tag
490 → 665. A retrained synth detector must be measured on a new frozen test set. **Update:** retrained on NSynth-train notes and measured on the fresh synth test set (`../synth-clips-2026-10-05/README.md`): synth hit ships (0.84 / 0.87); synthesizer stays hidden (0.80 / 0.48). Pass bar is now 60/60 (user, 2026-10-05).

### Vocal one-shot tag (2026-10-06)

The app had no vocal-one-shot tag, so that row (369 test clips) scored 0. On clips of 2.25 s or less, a shown `voice`
tag from the one-shot voice head now also adds `vocal one-shot` (same score and threshold; `SHORT_CLIP_DERIVED` in
`src/audio/shortClipModel.ts`), and `scripts/short-clip-displayed.mjs` maps that label to `role:vocal one-shot`.
Re-scored offline from the same test exports (exact: the tag is a pure function of the stored voice tag):

| Build | role:vocal one-shot P / R | TP / FP / FN |
|---|---|---|
| v2 (13/27 build) | — / 0.00 → 0.99 / 0.64 | 236 / 2 / 133 |
| v2 + five new heads (16/27 build, other session) | 0.89 / 0.02 → 0.99 / 0.65 | 238 / 3 / 131 |

Passes 60/60, not 70/70. The misses are almost all AVP beatbox clips (104 of 111 missed); Freesound voices are found
231 of 252 times. Beatbox recall is the remaining gap, for the voice and beatbox heads.

## 6. Below target, unsupported, or open

- **Below 70/70:** see the table. Biggest problem: `source:synthesizer` shows on 174 non-synth clips (about 12% of
  non-synth one-shots). 154 of those also show `synth hit`: the synth-hit head fires on drums, voices, explosions and
  gunshots, and the app copies a `synth hit` tag into the `synthesizer` source. FSD50K clips are *unknown* for the synth-hit
  role, so the table's synth-hit precision (0.68, counted on NSynth only) overstates it. Both heads were trained on Surge
  renders that are easy to tell apart from Freesound audio. Removing or retraining them would be a change made after
  seeing test results; it needs a fresh test set or must be reported as such.
- **Unsupported, abstains (every positive counted as a miss):** distorted / reverberant (no short-clip training labels), bass hit (failed on development data), beatbox (no labelled negatives), vocal one-shot role (no generic role label; `voice` source shown instead), brass, risers (no licensed labelled data found).
- **Quiet clips** did not improve (recall 0.17 before and after).
- **Tempo/key:** 0 keys shown on 333 single events; 1 tempo shown (both builds).
- **Contamination risk:** another session's training list (`extras/percussion.json`, Freesound One-Shot Percussive) contains 108 of these test clips. Measured builds used `learned.json` `3bf330fa…`, and v2 hides all `learned.json` heads on short clips, so results here are unaffected. Future heads must exclude `reserved-test-families.json`.
- **Stale e2e test:** `e2e/audio.spec.ts` fails on the baseline build too: the "Play sample"/"Correct the instrument" controls it drives no longer exist.

## 7. Upload-to-result time (real app, headless Chromium, software rendering) — pre-merge builds

`scripts/short-clip-timing.mjs`: seconds from handing the file to DGE until its finished analysis is in the graph export.
Cold = fresh browser profile; warm = a different clip of the same length right after. Calibration clips only.
Builds were run interleaved (baseline → control → v2, three rounds) because the machine was shared (load 20–40).
"Control" is the v2 tree with the one-shot model unpinned, so control vs v2 isolates the one-shot model; baseline vs
control also includes other sessions' changes (concurrent model families, model preloading).

| Build | Cold 1 s | Warm 1 s | Cold 2 s | Warm 2 s |
|---|---|---|---|---|
| Baseline | 17.1 | 4.8 | 17.6 | 6.3 |
| Control | 15.5 | 5.2 | 16.2 | 5.5 |
| v2 | 18.9 | 5.4 | 27.2 | 5.3 |

Medians of 3. Warm results are unchanged within noise. Cold results vary 10–36 s between rounds of the *same* build, so
the higher cold v2 medians are **not resolved** by this data. The one-shot model adds no model run (it reads the existing
CLAP fingerprint) plus one 16 kHz decode of the clip; a quiet-machine rerun is needed to confirm or rule out a cold-start cost.
Batch throughput in the full test runs: 4.0 s/clip (baseline) vs 3.9 s/clip (after-v1).

## Reproduce

```bash
python3 scripts/build-short-clip-bench.py
node scripts/short-clip-features.mjs <list.json> <out.jsonl>
SET=clapRepeat <venv>/python scripts/train-short-clip-heads.py export
npm run build
node scripts/short-clip-upload-eval.mjs <out-dir> test 60
npx vite-node scripts/short-clip-displayed.mjs <out-dir>/graph-export.json <out-dir>/r
python3 scripts/short-clip-report.py <out-dir> test > <out-dir>/report.json
node scripts/short-clip-timing.mjs <out.json> 3
```

## Very short clips (2026-10-05)

Bass one-shots under about 1 s were mostly missed. The development set had only **3 bass-hit positives under 0.5 s, and 20 under 1 s, of 255**. An external pack of 80 bass one-shots (0.2–1.8 s, positives only, never trained on) found 17/80 with the shipped head, and 3/28 of those under 0.5 s.

`scripts/short-clip-crops.py` (seed 20261005) adds training clips cut from the start of longer development clips: 0.15–1.0 s, 25 ms fade-out. It uses 252 bass-hit sources and 2,500 other labelled sources, and keeps each source's labels and family group. Fingerprints are `clapRepeat` only (`REPEAT_ONLY=1 node scripts/short-clip-features.mjs`). The bass-hit head was retrained with `CROPS=1 ONLY='role:bass hit'`, merged into `short-clip.json` with the existing standardisation (`STATS_FROM`/`MERGE_INTO`); every other head is unchanged.

Crops are training-only (`AUG` in the trainer): they join every fold's fit, but C, the threshold and every reported metric use original clips only. Grouped 5-fold out-of-fold, the trainer's own threshold rule:

| Training | Original clips P / R / F1 | Threshold | Crops < 0.5 s recall | Crops 0.5–1 s recall | False tags on crops < 0.5 s |
|---|---|---|---|---|---|
| without crops | 0.838 / 0.792 / 0.815 | 0.908 | 72/101 | 108/151 | 7/1107 |
| with crops (shipped) | 0.850 / 0.776 / 0.811 | 0.946 | 81/101 | 116/151 | 8/1107 |

The external pack, read three times during this work and **not to be used for further tuning**, went from 17/80 to 36/80 with crops at an earlier comparison threshold (0.873); the shipped head's higher threshold (0.946) was not re-read on it. Its remaining misses mostly score 0.5–0.87, and their nearest training neighbours are synthesizer / synth-hit clips: a sound-character gap, not only length. CLAP + PaSST features scored 1/28 on that pack under 0.5 s (PaSST zero-pads to 10 s), so PaSST is not used there. No held-out test number exists for this head; a new frozen set is needed for one. Selection report: `development-selection-bass-crops.json`.
