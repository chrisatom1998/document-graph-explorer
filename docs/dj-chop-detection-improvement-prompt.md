# Prompt: improve DJ-mix sound and chop detection

Written 5 October 2026 from a Hugging Face Hub search. Paste everything below the line into a fresh Claude Code session in this repo. The model findings come from Hub model cards and were not run on project audio.

---

You're working in the Document Graph Explorer repo (local-first, GPL-3.0). Goal: improve how it finds and identifies sounds in DJ mixes, especially CHOPS (chopped/re-pitched vocal and instrument slices). Start by reading AGENTS.md, docs/dj-classifier-training.md, docs/music-instrument-evaluation.md, docs/audio-evaluation-infrastructure.md and docs/dj-sound-catalog.md, then skim src/audio (analyzeMusic.ts, fusion.ts, tempo.ts, djClassification.ts, the passtCandidate and temporalCandidate folders).

## What already exists (don't rebuild it)
- Bundled models: AST AudioSet (Xenova ONNX), CLAP larger_clap_music_and_speech, Discogs-EffNet + MTG-Jamendo instrument head. Pinned by sha256 in manifests, fetched by scripts/download-music-model.mjs.
- A 194-label DJ catalog, a learned head set (about 1,653 reviewed examples), fusion logic, a review server, and an evaluation harness.
- Hard constraints: processing stays in the browser, the air-gapped build must still pass (npm run build:airgap), and bundle budgets (check-bundle) must hold. Models are pinned by revision and checksum, never fetched at runtime from unpinned URLs.
- Known gap from the docs: a chop is an editing technique, not a sound source, so tagging whole clips can't detect it. No positive vocal-chop training examples exist, and there is no independent test pack.

## Findings from a Hugging Face search (verify each before relying on it)
- musetric/beat-this-onnx: beat/downbeat tracker, ONNX for onnxruntime-web (WebGPU or WASM), 120 MB, MIT. Host must compute the log-mel features exactly as its README specifies.
- nsosu/demucs-onnx: despite the name, Open-Unmix UMX-L stems (vocals/drums/bass/other), 4 x 113 MB ONNX, you do STFT/ISTFT yourself. Card says MIT; the upstream weights may be non-commercial, so check.
- airasoul/wav2vec2-base-drum-kit (MIT, 10 drum classes) and yojul/wav2vec2-base-one-shot-hip-hop-drums-clf (Apache-2.0, 7 classes incl. 808). PyTorch only, trained on isolated one-shots, so they need ONNX export and clean stems.
- mispeech/dasheng-base (Apache-2.0) and Xenova/larger_clap_general (78 MB quantized audio encoder) as extra embedding sources.
- Non-commercial, offline-evaluation only: OpenMuQ/MuQ-MuLan-large, m-a-p/MERT-v1-95M and MERT-v2-30s (all CC-BY-NC-4.0), nvidia/music-flamingo-2601-hf (8B, for pre-labelling only).

## Proposed pipeline
Separate stems, then beat grid, then slice at onsets, then find repeated/re-pitched beat-aligned segments, then label each segment with the existing CLAP prompts and heads.

## Plan (spike first, one phase at a time, stop and report between phases)
1. Beat grid: integrate Beat This in a worker, compare against the current tempo.ts on the existing test clips, and keep the old path as fallback.
2. Stem separation spike: measure real download size, memory, and wall-clock time for a 3-minute mix in the browser. Decide whether it's viable as an optional on-demand download (not bundled). Resolve the licence question and record it.
3. Chop candidate detector: onset-slice the vocal and "other" stems, snap to the beat grid, cluster segments by embedding similarity (reuse CLAP/AST embeddings) to find repeats and pitch-shifted repeats, and emit time-ranged candidates with evidence. Surface them as estimates, never as confirmed labels.
4. Drum labelling: export one drum classifier to ONNX, run it on the drum stem, and measure whether stem artifacts hurt it.
5. Offline benchmark (no shipping): compare MuQ-MuLan and MERT against current CLAP on the reviewed clips and report whether a music-specific model separates chops from synths better.

## Evaluation rules
- Build a small rights-cleared set of real mixes with human-reviewed chop/non-chop segments, including hard negatives (breathy synths, drum hits, chopped instruments). Hold out whole tracks or packs.
- Report per-class precision/recall and note support counts. Don't claim general accuracy from small sets, and don't turn model suggestions into training labels.
- Keep tests passing (npm run typecheck, lint, test) and add tests for every new decision rule.

Deliver a short written report after each phase: what you measured, what you'd ship, what you'd drop, and why. Ask before adding any dependency or bundled model over 50 MB.
