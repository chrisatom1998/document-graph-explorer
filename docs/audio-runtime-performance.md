# Browser audio runtime validation

The decoder and worker-lifetime changes are implemented in commit `b61acdacb26e70ceee0c27d30fcb73c90176834b` on draft PR86. They preserve the existing detection policy; no learned accuracy head is enabled by this change.

## Behavior

- Bounded decoding requests one second of lookahead, then crops to the requested sample count. This fixes compressed clips whose decoder tail previously produced a short buffer and caused recognition to fail. The preprocessing identity was revised so previous cached results are not reused under the new decoder.
- On browsers reporting at least 16 GiB through `navigator.deviceMemory`, retain up to four model-family workers while serializing inference. Lower or unknown reported memory retains one worker. Model identity changes, cancellation, worker errors and five-minute idle cleanup release the appropriate workers.
- An outer cleanup handler restores idle cleanup even if reading a file or opening its decoder fails early.

## Same-input detection checks

Twelve real, rights-cleared 10-second OpenMIC development excerpts produce exactly the same 7,428 raw sound scores and 12 auxiliary music scores as the qualified corrected browser reference: maximum absolute difference 0 across 7,440 numeric values. Six paired original-worker/candidate runs also preserve final instruments, sound profile, tempo/key, pitch, notes and coverage. This proves output parity for these inputs, not improved classification accuracy or universal parity.

## Timings

Apple M5 Max, 18 logical CPUs, 36 GiB physical memory; Chrome 154.0.8037.93 reports 32 GiB through `navigator.deviceMemory`. Full `analyzeMusic` mode includes fingerprinting, preview, three sound-model families, tempo/key, aggregation and cache writes. These measurements exclude the file picker, graph rendering and other caller work. Model files were already on local disk; a cold browser cache does not measure internet download time.

| Path | Samples | Median | Observed p95 |
| --- | ---: | ---: | ---: |
| Candidate warm, unseen 10-second excerpts | 10 | 9.895 s | 12.920 s |
| Paired original single-worker warm baseline | 5 | 15.061 s | 18.096 s |
| Candidate cold browser/model cache | 1 | 26.021 s | Not estimated |
| Candidate fresh sessions, cached assets | 1 | 19.553 s | Not estimated |
| Candidate saved-result cache | 12 | 6.45 ms | 10.20 ms |

The candidate median on the same five paired inputs is 10.326 seconds, with each pair improving 31–36%. The observed p95 uses nearest rank and equals the maximum at these small sample sizes. All ten warm unseen excerpts finished below 16 seconds; cold runs did not. These findings do not establish a 16-second whole-song bound.

The timed build used an 8 GiB worker-retention predicate. The final 16 GiB predicate and later outer-cleanup change were qualified separately; this Mac reports 32 GiB, so both predicates select the same four-worker branch. The published source is not being represented as a separately repeated full timing sample.

The sampled browser/driver process-tree RSS peaked at 4.259 GiB versus 2.484 GiB for the baseline. Summed RSS can count shared pages more than once; these are approximate process-tree measurements, not unique memory footprints. Final capability-guard qualification observed four new workers on the first clip and zero on the next unseen clip, with exact raw-score parity. Lifecycle checks cover cancellation and early decoder failure.

## Validation and limits

At the published runtime commit: full lint and app/E2E TypeScript pass; 1,946 tests pass with one skipped. The actual production build and runtime/model/bundle checks pass, and all 67 linked public asset hashes remain unchanged. The final cleanup fix was also exercised through the actual browser module and a complete analysis/cache smoke. GitHub Actions run `37092856583` at this exact commit passed build/test, Docker and all 17 browser E2E tests.

No locked accuracy-test labels were used to select this runtime change. The larger browser-trained recognition policy remains a separate validation task. A previous 153-second synthetic composite took 427.894 seconds on the baseline under concurrent workloads, mostly in AST inference; it is not a real-song accuracy result or a candidate timing. An exploratory WebGPU path changed scores and was not adopted.

## Additional real UI upload check

The final runtime build was also exercised through the actual Add files UI on the same Mac and Chrome. Completion was measured when complete recognition was persisted; graph-ready rendering time was not measured separately. An isolated baseline harness called the prior scheduling implementation directly, so these UI/harness spans are not identical benchmark boundaries.

| Same audio | Updated UI upload to persisted completion | Baseline analyzer call |
| --- | ---: | ---: |
| 10-second CC BY 4.0 OpenMIC development excerpt, fresh context | 13.564 s | 14.084 s |
| 36.571-second continuous CC0 recording, warm unseen input | 43.001 s | 47.901 s |

The longer recording is “The Torrent” by Stereo Surgeon, [Freesound 327722](https://freesound.org/people/Stereo%20Surgeon/sounds/327722/), declared CC0 1.0 in the published FSLD 1.0 metadata. It is a real continuous FX/loop recording, not a full-song benchmark. Its SHA-256 is `0b2caee535ed361bd446b8611d3378b8b614f7668833f65bc22f0df5969af765`.

All seven planned windows completed for AST, Jamendo and CLAP, covering the full 36.571 seconds with no gaps. All 4,333 instrument/sound scores and final instrument decisions, sound profile/evidence and key outputs matched exactly. Tempo remained 140.1 BPM; its confidence differed by 0.0009840726852416992 (candidate 0.644690195719401, baseline 0.6456742684046427). Therefore this is exact sound-detection parity, not bit-for-bit equality of every analysis field. The short upload matched all compared outputs apart from run timestamps.

UI reanalysis of the longer recording completed in 2.189 seconds using cached results where available; some analysis-family requests still occurred. Approximate peak process-tree RSS was 3.997 GiB for the UI test and 2.436 GiB for the baseline. No application page errors or external requests occurred.

The 16-second target applies to tested short excerpts. Longer recordings are allowed to exceed it while preserving coverage. These two examples are not a p50/p95 sample and do not replace the earlier ten-clip warm benchmark.

The additional full-mode UI cancellation attempt did not qualify cancellation: the test waited for a background-only Stop analysis control. This is a test-selector limitation, not evidence of a product failure. Source cancellation tests and the separately recorded real-module lifecycle checks pass; a targeted visible UI cancellation check remains separate.
