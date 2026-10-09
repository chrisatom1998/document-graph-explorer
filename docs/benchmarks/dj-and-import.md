# DJ accuracy and folder-sized import benchmarks

These tools measure the existing app without changing models, thresholds, or UI.
They replace machine-specific paths with explicit inputs and keep incomplete analyses visible.
No new accuracy or latency result is claimed merely because these tools pass their tests.

## 1. Assemble verified real audio

Create an inventory JSON next to your audio (paths may also be absolute). Use the app's exact
`dimension:label` names: `source`, `effect`, `vocal`, `role`, or `character`.
For example, the app's production tags become `effect:vocal chops`, not `production:vocal chops`.
The following is a **schema example**, not supplied audio or measured ground truth:

```json
{
  "labels": ["source:synthesizer", "source:voice", "effect:vocal chops"],
  "clips": [
    {
      "id": "clip001",
      "path": "audio/reviewed-loop.wav",
      "group": "artist-or-pack-family-001",
      "split": "test",
      "kind": "loop",
      "truth": {"source:synthesizer": 1, "source:voice": 0, "effect:vocal chops": 0},
      "provenance": {"type": "human-reviewed", "reference": "review record with reviewer and date"}
    }
  ]
}
```

- Use `1` for verified present, `0` for verified absent, and `null` for unknown.
  Every declared label must have one of those values. Never turn an unmentioned uploader tag into an absent label.
- Provenance must be `human-reviewed` or `published-annotation`, with an audit reference.
  This records the curator's assertion; software cannot verify that someone actually listened.
- Keep takes, crops, remixes, and related packs/artists in the same `group`. The tool rejects a
  group crossing development/test and rejects identical audio bytes. It does **not** detect perceptual
  duplicates; audit those before freezing. Choose a common group when artist/pack relationships overlap.
- Include real one-shots, loops, and mixed tracks, especially confusing bass/synth and vocal/non-vocal
  chops. Include at least 20 verified positives and 20 verified negatives per target class; 30+ is preferable.
  The report flags insufficient support. Sparse labels are allowed but never advertised as a fully labeled set.
- Keep test clips out of training and tuning. Existing repeatedly inspected DGE benchmarks are useful
  historical comparisons, not fresh untouched tests. No data is fetched or relicensed by this tool.

Reuse explicit human confirmations from DGE's existing local review service:

```sh
node scripts/benchmarks/reviews.mjs /path/to/review-data assignments.json inventory.json
```

`assignments.json` contains `labels` as above and a `clips` object keyed by review item ID,
each value containing `group`, `split`, and `kind`. Only `confirmed: true` reviews with
`provenance: "explicit human confirmation"` are accepted. Assistant reviews, drafts, and automatic
labels are rejected. Unreviewed categories remain unknown. The adapter uses the reviewed preview,
not a longer original recording the person may not have heard.

Freeze the inventory, verify durations with FFprobe, and copy the exact bytes to anonymous names:

```sh
npm run bench:dj:prepare -- inventory.json /path/to/frozen-dj-set
# Optional: reject test hashes/groups that appear in a prior training/tuning manifest.
npm run bench:dj:prepare -- inventory.json /path/to/another-frozen-set training-manifest.json
```

The output contains `audio/`, `manifest.json`, and `manifest.sha256`. Existing outputs are never
overwritten. The audio is not normalized, clipped, or re-encoded. Keep private/restricted audio and
manifests outside git. The excluded manifest uses this same frozen schema; its check is only as
complete as the supplied training inventory.

## 2. Run real-app accuracy

Install the repo dependencies, prepare its models (`npm run setup:music`), and build once:

```sh
npm ci
npm run setup:music
npm run build
npm run bench:dj:run -- /path/to/frozen-dj-set/manifest.json artifacts/dj-run-001
npm run bench:dj:score -- /path/to/frozen-dj-set/manifest.json artifacts/dj-run-001/graph-export.json artifacts/dj-run-001/scorecard.json
```

Requires the Playwright Chromium for the installed version. On a developer machine install it with
`npx playwright install chromium` if missing; in managed sandboxes follow `AGENTS.md` and use the
preinstalled browser. `CHROME_PATH` optionally selects an installed executable. The runner starts
its own built `vite preview` on loopback (default 4295), uses a fresh browser context, and never attaches
to a user profile or existing live app. `--port=...`, `--dist=...`, and `--timeout=1800` are supported.
Timeout is per import in seconds and is enforced even when the page stops answering.

The runner checks input bytes and any manifest seal, hashes the complete deployed directory,
records source commit/dirty state and browser/device capabilities, imports all test clips with
anonymous filenames, and saves the actual graph export. A failed/partial/cancelled/missing analysis
is an unsuccessful run, even if every file appeared in the graph.

The scorer calls the current `confidentSoundSummary` directly. It rejects listener corrections and
AI-assisted labels in predictions. It separately reports **all displayed** and **likely** model tags;
the latter excludes maybe, uncalibrated, unknown-coverage and possible tags. It does not apply a new
threshold or interpret similarity scores as probabilities. Filename hints cannot help because names
are opaque. `scorecard.json` reports TP/FP/FN/TN, precision, recall, F1, failure coverage, unknowns,
and false-positive/false-negative IDs, by class, duration and clip kind.

Incomplete positive examples count against end-to-end recall; incomplete negative examples do not
earn true negatives or inflate precision. Quality targets require enough positive/negative support,
no missing observations for the class, and 70% precision **and** recall. A class may be undefined
or unsupported. This is not a single overall accuracy claim. Freeze the manifest **and scorer commit**
before comparing models; do not select thresholds from test errors.

## 3. Run folder-sized imports

Use the same schema's **development** partition. Need at least 501 distinct clips for the defaults:
500 measured plus one different warmup clip. Reusing a ten-file set 50 times would measure dedupe,
not a real 500-file import, so the runner refuses insufficient inputs.

```sh
npm run bench:import -- /path/to/frozen-dj-set/manifest.json artifacts/import-run-001
# A smaller first pass:
npm run bench:import -- /path/to/frozen-dj-set/manifest.json artifacts/import-small --counts=10,30 --repeats=3 --timeout=1800
```

For every size and repetition it runs:

1. **cold-profile**: fresh browser profile, first measured import. Assets may already be in OS/server
   caches, and the app can speculatively preload after page load; this is not an internet cold-download guarantee.
2. **cached-reimport**: same files in that profile. Measures the user's duplicate/cache-reuse path,
   not uncached model performance. Worker responses record actual inference versus native cache hits when exposed.
3. **warm-unseen**: separate fresh profile, first analyze a disjoint warmup clip, then import unseen files.
   The warmup stays in the graph (N + 1 total nodes); its time is recorded separately and excluded from summary timing.

Each measured span runs from file-picker handoff until every requested clip is terminal in the saved
graph, the search control is ready, observed worker requests finish, and graph counts/statuses remain
stable for 1.5 seconds. The span includes up to 500 ms sampling latency and that stability wait.
This tests **folder-sized multi-file ingestion**, not native folder picker/directory enumeration,
and does not claim that force-layout coordinates have fully converged. Full recognition is required
for a valid timing; failed runs are counted and retained, not silently excluded.

`run.json` includes per-run seconds, completion counts, model/graph-worker request spans, inference
execution flags, IndexedDB transaction durations, UI long tasks, and sampled page JS-heap peaks.
Worker request spans overlap and include queue/cache/model-loading time; they are not isolated
inference or decoder CPU timings. Page heap excludes worker/WASM/GPU and browser-process memory.
For total memory use a separate process-tree profiler on the target device. Three repeats produce
an **observed** median/p95, not a statistically stable population tail estimate. Run identical manifests,
browser, machine, display mode, and cache scenarios when comparing commits. Do not compare new
results directly with old analyzer-only timing tables.

## Validation and current limits

```sh
npm run test:benchmarks
npx vite-node scripts/benchmarks/display.check.mjs
```

CI runs the contract tests and verifies the scorer against the shipped display policy. Those checks
need no inference weights. Actual measured reports still require the real labeled audio, built assets,
model weights, and browser. No such corpus or baseline result is included in this change. The current
work environment lacked those assets and Chromium, so only the dependency-free checks ran locally.
