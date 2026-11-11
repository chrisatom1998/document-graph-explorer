# Selective tag adoption review — November 4, 2026

Status: **no candidate has passed the available checks; no candidate outputs adopted**. This is a draft evidence record, not a model release.
The checked-in `public/tagger-model/model.json` exactly matches the shipped HF revision below. The browser weights,
policy, thresholds, parity fixtures and combine request are unchanged. Newer r26–r28 runs are outside this review.

The October 31 681-clip judge report identifies seven gains of at least .03 F1. This review checks all seven against
existing private run evaluations before considering selective adoption. Those judge clips are a subset of FSD50K eval;
the larger FSD50K results below are **not an independent confirmation** of the judge gains.

## Sources and calculation

- Shipped: [`cmjatom/dge-all-tags-tagger-nc@410638ae8e38766f1647af233157a0c0c95da96a/eval.json`](https://huggingface.co/cmjatom/dge-all-tags-tagger-nc/blob/410638ae8e38766f1647af233157a0c0c95da96a/eval.json).
- Candidate: [`cmjatom/dge-sound-tag-candidate@59a3370c0c236c337e202c8cad0d7476c711db05/drums-any-r1/eval.json`](https://huggingface.co/cmjatom/dge-sound-tag-candidate/blob/59a3370c0c236c337e202c8cad0d7476c711db05/drums-any-r1/eval.json).
- Candidate training: repository `df478198aa967d66ddf9c11424aae16449f7fc30`, initialized from private
  `dge-instrument-tagger@29090c5d7f26daad8b9bf3cc9dc079161a4809de/all-tags-recall2`, per candidate `data-manifest.json`.
- `comparison.json` retains only aggregate evaluation rows and immutable source references. No audio or private clip IDs
  are included. P/R are the source's rounded values; F1 is calculated from TP, false detections and positive counts.
  Positive and negative counts match for each paired row. Matching counts do not prove identical clip IDs or labels.

## Paired stored evaluations

| Tag | Split | Pos / neg | Old P / R / F1 | Candidate P / R / F1 |
|---|---|---|---|---|
| piano | eval-round1 (all) | 23 / 12 | 1.000 / 0.957 / 0.978 | 1.000 / 0.957 / 0.978 |
| piano | eval-round2 (all) | 15 / 17 | 0.933 / 0.933 / 0.933 | 0.929 / 0.867 / 0.897 |
| piano | holdout-r3 (strict) | 140 / 0 | 1.000 / 0.871 / 0.931 | 1.000 / 0.686 / 0.814 |
| glockenspiel | eval-fsd50k (all) | 60 / 4824 | 0.820 / 0.683 / 0.745 | 0.774 / 0.800 / 0.787 |
| vinyl scratch | eval-fsd50k (all) | 38 / 4846 | 0.727 / 0.842 / 0.780 | 0.857 / 0.632 / 0.727 |
| machine ambience | eval-fsd50k (all) | 301 / 4583 | 0.614 / 0.508 / 0.556 | 0.662 / 0.495 / 0.567 |
| vocal shout | eval-fsd50k (all) | 69 / 4815 | 0.471 / 0.232 / 0.311 | 0.373 / 0.362 / 0.368 |
| bell | eval-fsd50k (all) | 206 / 4678 | 0.718 / 0.617 / 0.663 | 0.717 / 0.602 / 0.654 |
| foley | eval-fsd50k (all) | 763 / 4121 | 0.714 / 0.626 / 0.668 | 0.703 / 0.659 / 0.681 |

## Decisions from the stored evaluations

- **Piano: retain shipped output.** DJ round 1 is unchanged; round 2 recall drops .933 to .867. Round 3 strict recall
  drops .871 to .686. Round 3 has no labelled negatives for piano, so its perfect precision cannot establish low false
  alarms. The small judge-set gain is insufficient to justify this regression.
- **Vinyl scratch: retain shipped output.** Larger FSD50K recall drops .842 to .632, F1 drops despite better precision.
- **Machine ambience and bell: retain shipped outputs.** Neither improves the combiner's min(P,R) criterion on stored
  FSD50K evaluations. Machine ambience trades lower recall for fewer false detections; bell slightly regresses.
- **Glockenspiel, vocal shout, foley: candidates only.** Their stored FSD50K min(P,R) increases by .091, .130 and .033,
  respectively. Glockenspiel F1 improves, vocal shout recall improves with worse precision, and foley improves slightly.
  All seven app outputs have no paired non-FSD50K rows here except piano. These gains therefore do not satisfy this
  review's independent-data requirement. Do not force them through `--pin` using these numbers.

## Fresh local checks — November 5, 2026

See [local-paired-eval.json](local-paired-eval.json) for confusion counts, frozen thresholds, model checksums and cache
references, and [ancestry-audit.json](ancestry-audit.json) for the aggregate lineage audit. The checks below were
actually run locally on CPU; they are not a proposal for a future paid evaluation.

The existing cache was accessible with the authorized HF credential. Downloaded VCSL metadata/audio and run 9
metadata match their pinned Hub Git/LFS hashes at dataset revision `092291d29c8d89f1c83eed99d0728c1f992d1219`.
The run 9 subset was retrieved by HTTP byte ranges and independently retrieved again at that immutable revision;
the two 228-row arrays are byte-identical. No raw audio or private clip IDs are committed here.

Both the exact shipped ONNX and candidate ONNX were loaded with ONNX Runtime 1.31.1, CPUExecutionProvider, four
intra-op threads, batch size one. Every cached clip is already a padded 10-second, 32 kHz mono int16 window. Inputs
were converted to float32 and divided by 32768, as `evaluate.py` does. Model SHA256s were verified before inference.
No threshold was fitted, swept or changed. These are tagger-output checks, not end-to-end measurements of the app
with other detectors, short-clip overrides or long-recording rules.

| Tag | Set | Baseline at DGE cutoff | Candidate at its frozen cutoff | Result |
|---|---|---|---|---|
| glockenspiel | VCSL: 27 positives, 392 explicit negatives | 1 TP, 0 FP; P 1.000, R .037, F1 .071 | 1 TP, 0 FP; P 1.000, R .037, F1 .071 | Unchanged |
| glockenspiel | run 9: all 14 positives | 4 TP; recall .286 | 4 TP; recall .286 | Unchanged |
| foley | run 9: all 122 positives | 66 TP; recall .541 | 65 TP; recall .533 | Lower recall |
| vocal shout | run 9: all 92 positives | 37 TP; recall .402 | 32 TP; recall .348 | Lower recall |

**The actual app cutoff matters.** `src/audio/taggerPolicy.json` uses .15 for foley and .03 for vocal shout, rather
than the old calibration file's .2941 and .1989. Using those calibration cutoffs would make baseline recall look
like .361 and .174, and would incorrectly suggest large candidate recall gains against the shipped app. The source
artifact comparison above uses the archived calibration cutoffs; the fresh app-cutoff comparison is the appropriate
one for deciding whether to replace these outputs. Glockenspiel uses .3828 in both; the candidate uses .2462.

The 228-row subset is the union of **every** run 9 positive for these three tags, chosen only by existing labels,
not by model results. Other tags' absences are weak, so this subset supplies zero explicit negatives for these outputs.
Precision and F1 on it would be misleading and are omitted. Original run 9 metadata says the clips are unreviewed;
its positive labels are inherited dataset/uploader annotations, not fresh human validation. The stored candidate
true-positive counts (65, 32, 4) exactly match the fresh inference. VCSL counts also match both runs' archived reports.

### What ancestry checks established

For the candidate and available run 7/8/9/10/11/recall2 manifests, the listed training/validation IDs have **zero
exact-ID intersections** with either 419 VCSL evaluation IDs or 5,007 run 9 evaluation IDs. The candidate lists 36,547
training/validation IDs across these fields. `run9Ids["eval-run9"]` is explicitly an evaluation list and is excluded
from training-ID checks. VCSL held-folder lists match the candidate across the available ancestors; run 9 held-ID
lists match for the manifests that contain them. These checks do not establish audio-hash, render-family or uploader
deduplication across sources whose full metadata is absent.

### Exact remaining evidence gaps

Access to the cached audio and CPU inference is working; **there is no current sign-in or compute blocker**.
What is missing before a defensible adoption is:

- In private `cmjatom/dge-instrument-tagger@29090c5d7f26daad8b9bf3cc9dc079161a4809de`,
  `all-tags/data-manifest.json` and `all-tags-run5/data-manifest.json` both return HTTP 404. Their `log.json` files
  contain no training repository commit or full input ID/group/hash manifest. Run 5 initializes from
  `init/all-tags-run4/model.pt`, adding another ancestor to resolve. These manifests or equivalent historical
  training/validation input records are needed, not a new HF login.
- Several existing manifests use `@main` for initialization instead of an immutable parent revision. Recover the exact
  parent-weight hashes/revisions for run 7 -> run 5, run 10 -> run 7, and recall2 -> run 10, plus run 5 -> run 4.
- Full training/validation clip IDs, original-source IDs, uploader/performer/pack groups and audio fingerprints are
  absent for the source names listed in `missingFullIDLists` in `ancestry-audit.json` (including FSD50K, Freesound,
  round10 and several rendered/labelled sources). The current cache alone is not tied to every historical run.
  Those records are needed to exclude aliases, re-hosts and related renders across the whole initialization chain.
- Run 9 has no explicit negative labels for these three outputs. A reviewed, balanced replacement label file for
  `prep-cache/src/run9/18dba7d760651845/eval-run9.json`, or another appropriate independent set with strong
  positive **and** negative labels, is needed to measure false alarms. Preserve existing split/family reservations;
  do not turn its evaluation clips into training or calibration data. VCSL supplies strong negatives for glockenspiel,
  but both models are unchanged and miss 26/27 positives there.

These available comparisons do not validate any of the three remaining candidates. Piano and vinyl scratch already
regress on the paired reports above; bell and machine ambience do not improve the existing combiner criterion.
A documentation PR is **not completed integration**: production remains on the current outputs, and no model upgrade
is being claimed. New r26–r28 candidates, once separately verified, may change which outputs merit evaluation.

## Remaining validation before integration

The candidate manifest declares VCSL held folders, generated SAO prompt groups, and held-out Freesound uploader sets
as excluded from its training/tuning/calibration. Its training also includes Chris's train-half sounds and effect
renders, Freesound mirrors, NSynth train, Mixing Secrets, licensed commercial packs, Slakh and other sources. The
initialization run and every source of the shipped blend need the same ancestry and overlap audit; the manifest alone
is not proof of independence. Keep CC BY-NC-SA restrictions when producing derived weights.

1. Obtain matching baseline and candidate predictions on an appropriate independent labelled set for each proposed
   output, at frozen run thresholds. Candidate-only VCSL/SAO/fsnew rows cannot serve as a before/after comparison.
   Verify clip IDs, label version, uploader/artist/pack families, hashes and related renders across all training ancestors.
   Preserve locked test/judge sets for evaluation, never training or calibration; deduplicate at family level.
2. Re-score the baseline and candidate with identical labels before selection. The production combine job already
   refreshes FSD50K labels; this stored-metric comparison does not substitute for that step. Do not tune thresholds on
   these evaluation clips. Record P/R/F1 and false alarms, including separate recording and one-shot behavior.
3. Start from the exact shipped blend, allow only independently validated outputs, and retain every other output and
   its threshold. `combine.py --only` constrains candidate eligibility; `--keep` protects drums' tuned long-recording
   threshold. Existing `combine-request.json` describes how the old blend was assembled; it is not a safe new baseline.
4. Combine/export on free local CPU if available, verify ONNX/PyTorch parity and unchanged nonselected outputs, then
   update immutable download revision/checksums, policy thresholds/revision and parity fixture together. Run tagger
   tests and the repository lint/typecheck/test/build checks. Only then consider a release PR.

No paid job, training run, workflow dispatch, model publication or commercial-audio upload was performed. In particular,
`tagger-combine.yml` launches a billed Hugging Face job and publishes weights, so this review does not dispatch it.
The absence of independent paired evidence is the current blocker; no measured production accuracy gain is claimed.
