# Luna normalization and audio-review pilot

## Run

```sh
npx vite-node scripts/luna-evaluation/run.mjs \
  docs/evaluations/mixed-music-2026-10-05/manifest.json \
  /path/to/current-graph-export.json /path/to/benchmark-audio \
  /path/to/new-results-directory 5 /path/to/detector-observation.json
node --test scripts/luna-evaluation/metrics.test.mjs
```

This command explicitly authorizes the selected benchmark audio uploads. It uses
only the existing server-side `OPENAI_API_KEY` (environment or `.env.local`). Never
copy the key into a graph export, browser setting, command argument, or report.

Preflight checks all 20 clips before paid requests: actual WAV/OGG/MP3 files named
by opaque manifest ID, completed current detector exports of matching ten-second
excerpts, evaluation rights, and no user corrections. The graph export must come
from the current app's real detector run; stale recognition configurations fail (recorded runtime thread counts may differ).
The original file’s SHA-256 must match the detector’s saved audio fingerprint.
Record the compute backend and original detector-run latency with the export.
The optional final argument supplies the benchmark observer JSON (`commit`, `backend`,
`timings` with one opaque ID and elapsed seconds per clip, and worker `stats.requests`).
When supplied, its commit and all selected clip timings are checked before paid calls;
the report preserves runtime evidence and states the timing measurement boundary.
These cannot be reconstructed from saved predictions. Hashes bind audio, manifest,
and baseline; the report records app commit and working-tree state.

The fixed ID-hash selection takes one clip per artist, first 10 for policy
development and next 10 held out. **Do not alter the fixed policies after seeing
held-out scores.** A later tuned policy needs another untouched artist set. The
models receive no manifest annotations, filenames, artist IDs, or benchmark split.
Luna sees only bounded machine evidence; GPT-Audio sees anonymous audio and no
native predictions. Annotations enter only the scorer, where unobserved classes
are ignored rather than called negative.

Policies: existing detector display policy, GPT-Audio alone, union, intersection,
existing native-unless-empty fallback, supported-name normalization, and replacing
normalized existing predictions with audio predictions only when Luna recommends listening.
The latter two are **evaluation hypotheses**, never automatic-label changes.
Failures use native evidence in the app. Paired accuracy metrics exclude audio
failures for every variant and report them explicitly. Development and held-out
reports remain separate. Per-class TP/FP/FN/TN, precision/recall/F1, labeled coverage,
abstentions, provider latency, raw usage, cost basis, and routing reasons are saved.
Zero-positive categories have undefined recall, not evidence of accuracy.

## Budget and failures

Maximum 20 clips, 20 Luna attempts, and 20 audio attempts, sequentially, no retries.
The requested dollar budget may be lowered but cannot exceed $5. Before each
request, reserve a conservative model-context upper bound at official standard
rates (Luna $0.27; audio $4.126). After known usage, release the difference. Without
audio modality details, price **all** input tokens at the higher audio rate.
Unknown usage keeps the reservation; failures stop. Local deterministic/cached
advisor shortcuts cost zero. Provider text and finish reason are checkpointed for
validation diagnostics, without request payloads, audio bytes, or credentials. A tight remaining budget may
therefore stop before 20 clips even when expected audio costs would fit. A new
run requires a new directory; paid outputs are checkpointed, never overwritten.
There is no claim of invoice-level billing precision or account-wide spend control.

Prices checked 2026-10-09:
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna):
  `gpt-6-luna`, text input $0.10/M, cached input $0.01/M, cache write $0.125/M,
  output $0.50/M. Responses supports strict Structured Outputs; no audio input.
- [GPT-Audio-1.5](https://developers.openai.com/api/docs/models/gpt-audio-1.5):
  `gpt-audio-1.5`, Chat Completions, text input/output $2.50/$10 per million,
  audio input/output $32/$64 per million. Structured Outputs unsupported; PR #172
  validates its JSON. Text-only output is requested.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):
  use `text.format` with `json_schema`, `strict: true`; independently reject
  incomplete, refused, malformed, unknown-ID, duplicate and noncanonical results.

The held-out split is independent of this pilot’s policy development, not a claim
that existing benchmark clips were never inspected during historical detector development.
Only instrument annotations are available here. DJ effects and character accuracy,
unseen genres, and arbitrary user recordings remain unproven. Ten held-out clips
have wide uncertainty; inspect counts and regressions, not only aggregate F1.

## Local preflight on 2026-10-09

Historical cloud preflight: see [report](../../docs/evaluations/luna-2026-10-09/report.json). Zero API requests,
$0 charged: the cloud checkout has no existing OpenAI key, current graph export,
or benchmark audio. `/Users/chrisjohnson/Projects/document-graph-explorer` is not
mounted. No measured accuracy or preferred fusion policy is reported.

## Real Mac pilot

See [measured partial results](../../docs/evaluations/luna-2026-10-09/mac-pilot/README.md).
All 20 native clips completed. Four paid requests cost an estimated $0.014767625;
the second audio response failed validation and the runner stopped without retrying.
Only one development clip is paired; held-out audio accuracy remains unmeasured.
