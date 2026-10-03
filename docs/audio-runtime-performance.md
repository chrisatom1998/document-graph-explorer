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

## Combined speed and trained source release

The measurements above describe the published b61 runtime. They are preserved as baseline evidence and do not measure the staged combined candidate below.

Audio analysis uses the existing local models and serialized model jobs. On a cross-origin isolated host with SharedArrayBuffer, ONNX WASM is configured for up to four threads, capped to reported hardware concurrency when below four. Other hosts use one thread. This does not enable WebGPU or send audio to a service.

Vite dev/preview, Vercel, nginx and the shared desktop/local static server send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on both pages and workers. Models and runtime resources remain same-origin. Custom hosts can omit isolation and retain one-thread inference. Cross-origin embedded resources must satisfy CORS/CORP, and opener relationships are isolated; validate optional integrations under the deployment's actual headers. Existing CSP remains in force.

Known recordings of at most thirty seconds share one FFmpeg decode at 16, 44.1 and 48 kHz. Each requested window receives its own copy so transferring a buffer cannot detach retained PCM. Retained sample arrays are bounded to about 12.4 MiB per decoder (additional FFmpeg/output copies exist). One second of decode lookahead preserves delayed codec/resampler tails; results are never padded. Unexpected output beyond thirty seconds falls back to bounded section reads. Long or unknown-duration recordings continue using bounded section reads. Close/abort clears retained PCM.

Whole-stream resampling followed by slicing can differ from separately seeking/resampling each window. Decoder configuration and thread identity therefore invalidate old result caches. Native caches also include the thread identity; PCM hashes remain part of their keys. Model worker result envelopes expose `runtime.backend`, `runtime.configuredInferenceThreads` and `runtime.identity`. These describe configuration, not proof that a cache hit executed inference.

Before promoting a model or reporting performance for this variant, bind the actual source/build/runtime assets and verify the real app's PCM, raw scores, decisions, full window coverage, cancellation and cache paths. Report cold, warm unseen and cache-hit timings separately with duration, hardware, memory and sample count. Repeated same-audio runs with native cache hits do not measure uncached warm inference. This change alone does not establish an accuracy or latency guarantee.


The combined production release now uses the independently frozen learned source policy after all 256 untouched held-out clips completed and passed the predeclared 75% micro-F1 target. It retains the classic dark graph interface requested for this local build.

| Same 256 clips, sparse observed truth | Precision | Recall | F1 |
| --- | ---: | ---: | ---: |
| Original frozen binary baseline | 88.89% | 47.71% | 62.09% |
| Combined frozen source policy | 72.86% | 89.91% | 80.49% |

The candidate has TP196, FP73, FN22 and TN239, with zero failed clips. Only 530 of 5120 class labels are observed (10.35% annotation coverage); 4590 are unknown and unscored. There are 783 positive predictions on unknown truth, which cannot be called correct or false. Definitive decision coverage is91.51% on observed truth and87.11% across all labels. A connected-component bootstrap over 49 groups (1000 resamples, seed20261003) yields an F1 interval of76.55–85.39%. Per-class performance and support vary; this is not an80% accuracy guarantee for every source or arbitrary audio.

Fourteen classes use learned heads and six retain guarded binary fallback decisions: accordion, guitar, piano, saxophone, trombone and violin. The policy is qualified only for complete ten-second OGG full-analysis inputs under `wasm-threads-4-jamendo-1-v2`. Other durations, modes, formats and runtimes remain explicitly outside this release's input qualification. OpenMIC does not validate tempo, key or DJ effects.

Qualification kept AST/CLAP at four WASM threads and Jamendo at one. Four-thread Jamendo aggregation changed 38 of 40 values in the first DEV example by at most 6.95e-8, with no decision change; it was not silently accepted as exact parity. The selected runtime's eight DEV app comparisons preserved 9904 PCM/raw numeric values exactly and 320 source heads within 1.81e-16 with exact states. A separately bound driver DEV run also passed before the locked test. Held-out browser/Node decisions match exactly, with maximum head difference 2.23e-16. No thresholds were tuned on held-out outcomes.

The user requested a read-only live label/score view after the frozen run had started. That reporting amendment changed no policy, model, input selection, retries, stopping rule or inference. The final result is the sealed all 256 evaluation, not a running subset or calibration result.

Final combined production build, app/E2E types and lint pass; 1981 unit tests pass with one skipped. The repeated 20-clip actual Mac UI and longer-recording checks are still being completed. Earlier timing tables remain evidence for their stated builds and boundaries; they are not measurements of the newly activated combined GUI.

Local restart without retraining or downloads:

```sh
cd /Users/chrisjohnson/Documents/Codex/2026-10-02/task-9/audio-combined
npm --ignore-scripts run build
npm run preview -- --host 127.0.0.1 --port 4250 --strictPort
```

The application is served at `http://127.0.0.1:4250/`.


## 2026-10-03 bounded reuse and decoder comparison

The current source retains at most two short (up to30second) decoded three-rate PCM snapshots between folder preview and deeper checks, bounded at approximately27MB. Known rates return owned byte-identical slices; other rates use the existing decoder. Four idle native family sessions are retained on reported8GB-or-greater devices or suitable high-concurrency hosts with unknown memory; reported low memory and two-thread devices retain the single-session fallback. Neural work remains serialized and idle workers expire after five minutes.

The local actual in-app-browser comparison of official FFmpeg0.12.10 single-thread and bounded four-thread decoders covered three original ten-second development recordings and a repeated60second performance fixture, twice each, at all three native sample rates. All24 compared PCM hashes matched. Four-thread decoding had no measured speed benefit: short decode totals were approximately24–38ms for both, while the long excerpt was approximately40–42ms single-thread versus43–44ms four-thread. Cold core load was80.78ms versus93.54ms. The faster existing single-thread decoder is retained. This fixture is not an unseen accuracy test or a real full-song benchmark.

AST and CLAP use up to four configured ONNX WASM threads only with cross-origin isolation and shared memory; fallback is one. Jamendo retains its one-thread qualification contract. Runtime observations distinguish executed inference from feature-cache reuse. Configuration is not a claim that every operation uses four physical cores. Historical timings above belong to their recorded prior source version; they are not measurements of this final release.
