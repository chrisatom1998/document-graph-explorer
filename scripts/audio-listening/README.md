# Does GPT-Audio improve the existing source labels?

Run the same labeled excerpts through the existing detector stack and the actual
GPT-Audio review function. No automatic-label policy is changed by this experiment.

```sh
node --test scripts/audio-listening/score.test.mjs
npx vite-node scripts/audio-listening/run.mjs \
  docs/evaluations/mixed-music-2026-10-05/manifest.json \
  /path/to/current-graph-export.json /path/to/opaque-id-wavs /path/to/results 20
```

Uses the existing `OPENAI_API_KEY` or `.env.local` key. Requires FFmpeg and WAV files
named `<manifest-id>.wav`. Makes one paid request per clip, sequentially, without
retries. Default 20 clips is a smoke comparison, not proof of improvement. A larger
limit explicitly increases the request budget. Authentication, permission and rate
limit errors stop the run. Results are checkpointed, but rerunning incurs new calls.

The baseline accepts a current graph export or the existing benchmark's array of
`{id, status: "complete", shown: [...]}` records. Generate it with the real built
app's benchmark runner on these exact clips. Do not use an older committed baseline
to claim improvement over current models. Record the app commit and compute backend
(GPU/WASM) alongside results. Manually confirmed labels must be absent. Manifest
annotations must describe the same first at most 10 seconds and allow evaluation.

Selection uses a fixed hash of clip IDs, independent of labels. The model receives
audio and an opaque alias only: no annotation, filename, baseline prediction or
confirmed answer. Source/excerpt and manifest/baseline hashes identify tested data.
Only explicit present/absent annotations count; unknown classes are ignored. Missing
baselines fail preflight, and failed API calls are excluded from **every** variant
and counted separately. Never compare variants with different clip coverage.

The report compares native labels, audio alone, their union, their intersection
(agreement), and audio used only when native produces no scored source class.
It reports per-class and micro precision, recall, F1, false positives and misses.
Requests retain token usage and elapsed time (including decoding); use actual
account billing to calculate cost. Union can raise recall at the cost of false
positives; agreement can raise precision while missing more sources. Do not select
a policy on this test set and report its performance as an independent result.

This benchmark covers 11 instrument/source classes. It does not establish accuracy
for production effects, character, BPM, key, arbitrary user clips, or unseen genres.
Before changing automatic labels, evaluate a separately held-out set, report sample
counts and uncertainty, and inspect class-specific regressions. Keep GPT suggestions
unverified until those results support a change.
