# Local audio evaluation infrastructure

This is evaluation plumbing, not a benchmark result or a calibrated decision policy. No corpus is bundled or acquired. Existing human reviews and the chronological `music-instrument-evaluation.md` record remain unchanged.

Run with Node 24:

```sh
node scripts/evaluate-audio.mjs manifest.json predictions.json test > report.json
```

The command reads two local JSON files and includes their SHA-256 hashes in the report. It does not load audio, call a model, upload data, train, choose thresholds, or alter the manifest. Threshold or prompt selection must use calibration data, never the held-out test split. Retain both input files with the application revision and model/configuration hashes alongside each report. `frozenAt` is a required declaration, not cryptographic proof of an immutable benchmark.

## Manifest contract

The version-1 object has `version: 1`, an ISO `frozenAt` timestamp, and a nonempty `items` array. Each item contains:

- Unique `id`, `split` (`train`, `calibration`, or `test`), and `tier` (`one-shot`, `loop`, `song`, or `stem`).
- `source`: locally recorded provenance; `rights: { evaluationAllowed: true, basis: "…" }`. This declaration does not independently verify rights or grant permission to train or redistribute.
- `groups: { original, artist, pack, sampleFamily }`: stable, nonempty provenance identifiers. A value in any grouping dimension cannot span splits. Variations and excerpts retain their original groups. Resolve missing provenance before admitting an item; do not invent identifiers that hide related material.
- `transformations`: an array of descriptions, empty for an original.
- `start`, `end`: finite seconds in the original, with `0 <= start < end`.
- `reviews`: entries with `reviewer`, ISO `at`, `dimension`, `label`, and `state` (`present`, `absent`, `uncertain`, or `unreviewed`).

Conflicting or uncertain reviews exclude that item/label opportunity from binary scoring unless an explicit `adjudications` entry resolves it. Each optional adjudication has `reviewer`, ISO `at`, `dimension`, `label`, `state` (`present` or `absent`) and a nonempty `reason`. Only one authoritative adjudication per item/dimension/label is permitted in a frozen snapshot; the original `reviews` remain intact. A label omitted from both records is unreviewed, never absent. No automatic adjudication is performed.

Predictions are an array of `{ itemId, dimension, label, decision }`, with `decision` equal to `accepted`, `possible`, or `unknown`. Export the product's decision as observed; do not promote possible labels for the report. All predictions must reference known items. Multiple accepted windows for the same item/dimension/label count once. Temporal localization requires a separate interval evaluation.

## Metric meanings and limits

Only explicitly and consistently reviewed present/absent item-label pairs are evaluated opportunities. Accepted predictions contribute true/false positives; unaccepted present labels contribute false negatives. Accepted coverage is accepted reviewed opportunities divided by all reviewed opportunities. Its complement is abstention rate. Precision and recall use ordinary TP/FP/FN denominators; missing denominators are `null`, never a perfect score.

The report includes per-class counts, overall micro metrics, `reviewedFalseExtrasPerReviewedItem`, and a separate count of accepted labels needing review. The false-extra rate divides explicitly reviewed false positives by items with at least one scoreable annotation, so adding completely unreviewed items cannot dilute it. It remains a lower bound when annotations are partial; use the accompanying `reviewedItems`, `itemAnnotationCoverage`, and `unreviewedAccepted` counts. Do not silently fold unreviewed labels into false positives. Multiple excerpts are correlated: `uniqueOriginals` does not establish statistical independence. These descriptive metrics alone cannot certify accuracy or a release gate.

The report also provides macro precision/recall and per-tier/per-dimension coverage. `provenanceGroups` counts connected components across original, artist, pack and sample-family identifiers. Exploratory 95% precision intervals use 2,000 deterministic percentile bootstrap replicates of those groups, not windows. A missing, degenerate or too-sparse interval is `null`; a perfect small fixture must not be used as evidence of perfect accuracy. Group independence still depends on complete provenance. These intervals do not implement a release certification gate.

`src/audio/evaluationSignals.ts` provides pure helpers for separately scored strict and half/double tempo (explicit relative tolerance), exact and related-key credit, no-pulse/no-key handling, interval intersection-over-union, and runtime summaries separated by named profile and cold/warm loads. Related-key credit follows [mir_eval's documented MIREX weights](https://mir-eval.readthedocs.io/latest/api/key.html), with descending fifths enabled. Tempo tolerance is explicit, consistent with the [relative-error convention](https://mir-eval.readthedocs.io/latest/api/tempo.html); it is not a reimplementation of that library's two-tempo weighted aggregate. Call helpers on predeclared evaluation segments; a root-only guess must not be converted into a major/minor key. Runtime fields left unmeasured remain `null`.

Before quality claims, supply a rights-cleared adjudicated corpus, predeclare slices and tolerances, record correlated source groups, run signal/runtime evaluations on actual outputs, and compare matched precision or matched accepted coverage. Real calibration, corpus collection, commercial licensing clearance, and measured quality gains remain unavailable in this task.

## Fixed revision comparisons and review workload

```sh
node scripts/compare-audio.mjs manifest.json baseline.json candidate.json match.json > comparison.json
```

Each revision is `{ "id": "revision-hash", "points": [{ "id": "fixed-policy-id", "predictions": [...] }] }`. Policies must be declared before inspecting held-out outcomes. The match object is `{ "metric": "precision", "target": 0.95, "tolerance": 0.01 }` or uses `acceptedCoverage`. Tolerances are absolute fractions. Both calibration points must be within tolerance of the target and of each other. The closest combined distance to the target wins, then lexical baseline/candidate point IDs break ties. No interpolation, threshold fitting or test-set selection occurs.

The selected fixed policies are evaluated on the test split. Deltas are candidate minus baseline. Calibration matching does not imply that held-out precision or coverage will match. Missing calibration matches or held-out denominators produce `insufficient`; unresolved known pairs or partially annotated items produce `partial`. `complete` only describes known data availability, never statistical sufficiency or exhaustive labels. Reports include actual calibration and test metrics, workload and SHA-256 hashes of all four inputs.

`reviewWorkload` counts supplied review events, adjudications, unique reviewer IDs, known item-label pairs, resolved/unresolved pairs and accepted predictions still needing review. The known universe is the union of annotations and predictions; omitted labels are unknown, not negative. Duplicate predictions do not inflate pair counts. Event counts preserve supplied history and do not measure reviewer minutes or deduplicate externally duplicated history. Explicit adjudication resolves a known pair without deleting events. Both CLI reports expose these counts. Real review time, device performance, a rights-cleared benchmark pilot and calibration remain outstanding.
