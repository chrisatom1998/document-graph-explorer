# OpenMIC pilot, 3 October 2026

The 90% F1 target is **not met**. This is a frozen, exploratory 48-clip instrument evaluation, not a calibrated or exhaustive recognition benchmark. No model weights or thresholds were trained or changed using these results.

| Split | Clips | Observed positive / negative labels | Candidate precision | Candidate recall | Candidate F1 | Observed decision coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development | 12 | 12 / 18 | 8/8 | 66.7% | 80.0% | 26.7% |
| Calibration | 12 | 10 / 13 | 6/6 | 60.0% | 75.0% | 26.1% |
| Locked test | 24 | 21 / 20 | 11/11 | 52.4% | 68.8% | 26.8% |

On the locked test, candidate recovery has TP=11, FP=0, FN=10. Automatic primary-source identification has TP=4, FP=0, FN=17 (recall 19.0%, F1 32.0%, observed decision coverage 9.8%). Explicitly accepted source observations have TP=0 and FN=21: machine evidence remains `possible`, so this policy abstains rather than pretending candidate suggestions are confirmed detections.

The test observes only 41 of 480 potential clip/class pairs (8.5%). Predictions on unobserved pairs are excluded, not counted as false positives or true negatives. Thus 11/11 precision does not establish 100% real-world precision. The connected-provenance bootstrap is degenerate with zero observed false positives, and correctly returns no confidence interval. Per-class support is very small; two of the 20 classes have no observed test label at all. Full per-class, tier, dimension and unknown-prediction counts are in the JSON reports. Every clip is in the song tier; these numbers say nothing about isolated samples or electronic chops.

## Frozen protocol and runtime

- Official archive MD5: `e4ccf187e2bb5ab2e115416e8aafe7f4`, 2,623,376,754 bytes. Selected audio: 48 clips, 6,123,290 bytes. No audio is committed here.
- Original selection SHA-256: `11c0a32a8bf0e6af01a187baabf29d00adc665abdefc7ded9023cbfd7369d97e`. The recorded freeze timestamp was corrected to the selection file's original creation time before inspecting predictions; clip identities, labels, policies and mappings were unchanged.
- The [manifest](evaluations/openmic-2026-10-03/manifest.json) preserves clip identities, CC BY/CC0 attribution/license references, artist/album/recording groups and observed annotations. Official `Y_mask` semantics are preserved, including observed negatives. Duplicate annotation pairs use the final row, verified against canonical NPZ values.
- Twelve official-train artists are development, twelve other official-train artists are calibration, and 24 official-test artists are locked test. Selection uses identity/provenance hash ranking, not model output. Artist, album and recording groups do not overlap across splits.
- All 48 clips completed actual Chrome 154.0.8037.93 inference through the app decoder and AST/Jamendo/Music CLAP workers. Non-loopback requests were blocked; none were attempted. No runtime errors occurred. Total measured inference time was 801.317 seconds; this includes per-clip cold browser contexts and is not a throughput benchmark.
- Reports preserve model revisions and asset hashes, including the 512-prompt CLAP catalog hash `60749591cdefb7d9cccb5c9b9524d71ab21f6e6f0f6a6f6ad6f94a400dca408c`, and hashes of complete local raw results. The harness snapshot used analysis revision 63 after the atmosphere-to-effect routing fix. Subsequent revision 64 invalidates old caches and fixes human-review display/sanitization; automatic source decision rules and model assets did not change. Separate synthetic controls use the final revision 64 build.
- `sourceCandidates` maps source-dimension observations marked possible/accepted. `primarySource` maps only `soundProfile.source`. `acceptedSources` requires an accepted observation. No filename, folder or human corrections contribute. Frozen aliases are defined in `scripts/openmic-pilot.py`; bass guitar maps to bass, never also guitar.

[Development report](evaluations/openmic-2026-10-03/development.json), [calibration report](evaluations/openmic-2026-10-03/calibration.json), [locked-test report](evaluations/openmic-2026-10-03/test.json). See [pilot preparation and limitations](openmic-pilot.md) for extraction and scoring instructions.

## Next evaluation

Preserve this pilot and never use its 24 test results to choose thresholds or aliases. Diagnose development/calibration misses, expand both from official-train artists with positive and observed-negative support across all 20 classes, and reserve a new larger artist-disjoint official-test subset before the next calibration cycle. Compare bounded per-class fusion policies with unchanged base models; do not relax global thresholds merely to increase recall. Report precision and recall together, with F1 as the improvement target.

OpenMIC does not label BPM, musical key, harp, vocal-chop subtype or effects, and pretrained-model overlap with this corpus is unknown. Real electronic/chop evaluation still requires rights-cleared independently reviewed labels; weak role/filename annotations are not ground truth. Do not convert assistant suggestions into training labels or claim general 90% accuracy from this pilot.

## Separate synthetic BPM/key controls

Six procedurally synthesized 24-second mono fixtures ran through the final local browser pipeline; no recording or training corpus was used. These are deterministic controls, not representative electronic music.

| Control | Truth | Output | Check |
| --- | --- | --- | --- |
| tempo-70 | 70 BPM | 70.1 BPM | Pass ±4% |
| tempo-100 | 100 BPM | 100 BPM | Pass ±4% |
| tempo-128 | 128 BPM | 128 BPM | Pass ±4% |
| tempo-160 | 160 BPM | 161.5 BPM | Pass ±4% |
| key-c-major | {'tonic': 0, 'mode': 'major'} | {'tonic': 0, 'mode': 'major', 'strength': 0.9626331925392151} | Pass exact tonic + mode |
| key-a-minor | {'tonic': 9, 'mode': 'minor'} | {'tonic': 9, 'mode': 'minor', 'strength': 0.8617976307868958} | Pass exact tonic + mode |

Tempo uses generated kick/noise pulses at 70/100/128/160 BPM; key uses harmonic triad progressions in C major and A minor. Strict tempo and octave-tolerant tempo are scored separately; exact tonic and mode are required for key. Only predeclared truth fields are scored. The pulse fixtures are not key labels and the chord fixtures are not tempo labels. Four tempo controls and two key controls cannot establish real-song BPM/key accuracy. [Hashes and detailed measurements](evaluations/openmic-2026-10-03/musical-controls.json).
