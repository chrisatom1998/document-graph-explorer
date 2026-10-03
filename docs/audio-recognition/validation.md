# Validation checkpoint

Implementation base: `ac0071525f9391e2d08b9d63ac52a4aeaac4db44`.
Restored the prior executor's complete nine-file patch, 32,546 bytes, SHA-256 `65b67cd6340fc16311f986a7d7058a3b0112fe3cf7bf42f5c48603a4c6b62054`. Base identity, forward apply and reverse apply checks passed before continuation. Independent evaluation work was preserved in separate files.

## Functional implementation

- Serialized independent AST/Jamendo/CLAP/tempo/key jobs, explicit per-model windows and coverage. A component failure stops only that component for the run; reanalysis is the explicit retry. Full-mode AST/Jamendo/CLAP windows include the tail; rhythm and tonal jobs retain sampled excerpts for tracks over 60 seconds, without a modulation map; fast mode records its sampled gaps. Unknown-duration files are discovered in bounded blocks before planning.
- Existing model families and fixed prompts only. Only one worker model family is retained at a time. The decoded window bound is 60 seconds for tempo/key or duration discovery and 10 seconds for sound jobs. Compressed originals still use the existing in-memory file path. No supported-device peak-memory or latency guarantee is claimed.
- A 128-entry cloned-result LRU, keyed by content SHA-256, weights, preprocessing, fixed prompts, window and label/configuration version. PCM is not cached. Evidence is capped at 12,000 entries and truncation is visible.
- Per-label possible observations, raw evidence scores, original-track intervals, processor padding policy, run/model versions and independent missing coverage. Machine instrument observations remain uncalibrated and create no automatic instrument edges. Existing named relationships and legacy heuristics remain backward compatible.
- Exact selected-only reanalysis, cancellation propagation, cancellation-result persistence and relationship refresh. Intermediate callbacks are not continuous crash-resumable checkpoints. Human instrument confirmations and scoped Confirm/Reject/Unsure history survive reanalysis. Earlier reviews remain editable even when their label disappears from new evidence.
- Local manifest validation, grouped split checks, partial-label-aware metrics, input hashes, exploratory grouped uncertainty and signal/runtime metric helpers. Fixed revision comparisons match precision or coverage using calibration data only, then report held-out deltas and explicit insufficient/partial outcomes. Review-workload counts describe known pairs and recorded events, not reviewer time. No corpus was collected, no model trained, no threshold calibrated and no accuracy gain measured.

## Environment and verification limits

Node 24.19.0, Chromium 151, Linux cloud workspace. Locked dependencies installed with `npm ci --ignore-scripts --cache /tmp/dge-npm-cache`; ordinary installation failed fetching the native ONNX runtime from NuGet. Browser implementation uses ONNX Runtime Web.

The existing AST/CLAP/Jamendo weight files are absent. Restoring the pinned assets was blocked by the network proxy's HTTP 403 for Hugging Face. No bypass or substitute weights were attempted. Production JS compilation and bundle-budget checks can run, but the normal build's final runtime-asset verification fails on missing weights. Browser checks therefore validate explicit unavailable-model behavior, not successful model inference or recognition quality.

The clean base already had two failing `agent/subagent.test.js` cases: “blocks hardlink and symlink aliases to sensitive files from read and search” and “continues to allow ordinary repository reads.” Both throw the standalone agent's sensitive-path guard in this environment. They are outside audio scope and remain unchanged.

Independent review covered the restored schema, orchestration, graph safety, human review UI, and evaluation infrastructure. It led to fixes for source-family collisions, duplicate-window completion, short unsupported Jamendo inputs, cancellation relationship refresh, conflicting correction controls, dropped-label review access, and evaluation annotation/enum handling.

Final command results and portable patch are reported in the task handoff. No commit, push, merge, deployment, new model family, external audio upload, corpus acquisition or training was performed.
