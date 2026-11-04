# Selective tag adoption review — November 4, 2026

Status: **validation blocked; no candidate outputs adopted**. This is a draft evidence record, not a model release.
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

## Adoption decisions

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
