# Accuracy follow-up

The 90% recognition target is not established. Pipeline completion, model coverage,
and passing tests do not measure recognition accuracy.

## Retain accepted voice evidence

Some vocal-chop clips already have a primary voice suggestion, but their timestamped
source observations omit voice. The analyzer now retains the existing qualifying
CLAP vocal/chop decision, including the exact prompt group and label that produced
its raw score. It does not change thresholds or model predictions. Direct source
voice evidence is not duplicated, and simultaneous instrument evidence remains.

The evidence view identifies the prompt basis. Its similarity score must not be
interpreted as a calibrated probability of voice. Imported evidence is validated,
and the recognition configuration marker distinguishes the changed evidence logic.

## Evaluate misses as well as false positives

Label evaluation now reports micro F1, macro F1, and positive/negative annotation
support alongside precision, recall, and coverage. F1 uses `2TP / (2TP + FP + FN)`;
an entirely missed positive class contributes zero. A class with no positives and
no positive predictions has undefined F1 (`null`) rather than an invented perfect
score. Macro F1 averages the defined per-class F1 values. Always inspect per-class
support and report the vocabulary and decision level used for evaluation.

Only explicit present/absent annotations are scored. Missing, conflicting, uncertain,
and unreviewed labels are not negatives. Possible suggestions do not count as accepted
predictions in the default evaluator. Any evaluation of suggestion retrieval must
declare that output policy separately before examining results.

## Observed limits

An exact ten-second, human-labeled harp/piano opening produced identical raw model
outputs on the pre-PR85 baseline and PR85. Both recovered possible harp and missed
piano. Piano was a weak or conflicted candidate, not simply a hidden leading result.
CLAP's pinned prompt vocabulary did not include harp. No threshold was lowered to
fit this example.

Nine previously selected local controls retained their primary voice/synthesizer
suggestions when the evidence patch was replayed. Two vocal-chop cases gained the
missing timestamped voice evidence. These correlated, partially labeled controls
cannot establish precision, macro F1, or broad 90% accuracy.

OpenMIC-2018 is a candidate for a separate instrument evaluation pilot:
[official release](https://zenodo.org/records/1432913) and
[official evaluation example](https://github.com/cosmir/openmic-2018/blob/master/examples/modeling-baseline.ipynb).
Its partial-label mask, supplied recording/artist partitions, per-recording licenses,
and possible overlap with pretrained model data must be retained. It does not provide
harp, vocal-chop, electronic-effect, BPM, or key ground truth. No OpenMIC score is
claimed here. Tempo and key require separate labeled evaluations.
