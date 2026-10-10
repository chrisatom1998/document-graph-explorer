# All-tags tagger blend: runs 3, 5 and 7 (2026-10-10)

Run 7 (EfficientAT `mn20_as`, started from run 5's weights, trained with the new Freesound, VCSL, Iowa, Slakh and
training-half Drive clips) joins the blend from [all-tags-blend-2026-10-09](../all-tags-blend-2026-10-09/README.md)
for four outputs only: the ones where it reached 50% precision and 50% recall on held-out **real** recordings and
the shipped file did not, plus rain ambience, which it raises past 70/70. Every other output is the same network
as before. The parity scores of the 20 existing policy outputs are identical to the previous file's, except rain
ambience.

## What ships

| | |
|---|---|
| Networks | Run 3 (`mn10_as`), run 5 (`mn20_as`), run 7 (`mn20_as`), sharing one log-mel front end |
| File | `public/tagger-model/model.onnx`, 160,329,743 bytes (160.3 MB, was 91.4 MB); sha256 `f00ea480…8242e9`. ONNX matches each run's PyTorch output within 2e-6 |
| Classes | 260: the 252 of runs 3 and 5, then the 8 run 7 added (bongo, tuned percussion, banjo, mandolin, pitched vocal, shaker loop, synth hit, vocal shush). The app reads only policy outputs |
| Cost per track | A third network runs on every window: about 1.7 times the previous blend's compute |
| Licence | **CC BY-NC-SA 4.0 (non-commercial).** Run 7 was also trained on non-commercial data (Mixing Secrets, the Drive training half) |

The model repo revision in `manifest.json` still has to be set when the file is published (`combine.py ... --only
'all-tags-run7=cat:animal sound,cat:percussion,cat:rain ambience,cat:tambourine'`); `sha256` already pins the file
built by that command.

## The four run 7 outputs

Real held-out sets only: FSD50K eval (no FSD50K eval clip was trained on), the held-out VCSL instrument folders
(VCSL folders hold one instrument each, so they test recall only). NSynth, code renders and the generated
Stable Audio clips are not counted. The thresholds are run 7's validation thresholds (calibrate.py, highest
min(P, R) on the validation split); nothing was tuned on a test or judge set.

| Tag | Before (shipped file, same clips) | Run 7 in the blend | Threshold (validation P/R) | App before | App now |
|---|---|---|---|---|---|
| animal sound | FSD50K .85/.69 (n=594), not in the policy | FSD50K **.86/.72** | .2411 (.79/.79) | CLAP zero-shot fallback, r19 .71/.38 | tagger, tested |
| percussion | FSD50K .89/.47 (n=343); VCSL R .60 (n=52) | FSD50K **.87/.55**; VCSL R .98 | .457 (.62/.62; FSD50K val .86/.73) | CLAP zero-shot fallback, r19 .78/.45 | tagger, tested (clips up to two windows) |
| tambourine | FSD50K .50/.20 (n=15); VCSL .75/.86 (n=7) | FSD50K **.75/.60**; VCSL **1.00/1.00** | .1181 (.82/.84) | tested detector, r19 .60/.44 | tagger, tested (clips up to two windows) |
| rain ambience | FSD50K .86/.66 (n=125), run 5 | FSD50K **.87/.70** | .6128 (.86/.85) | tagger, maybe (tested on the 50/50 promotion branch) | tagger, tested |

Full songs: on the 500 round-3 held-out songs (labels for these four tags unknown) the blend fires animal sound on
7, rain ambience on 0, tambourine on 22 and percussion on 68. Percussion and tambourine therefore get the
`detectors` long-recording rule: on recordings of two or more windows the existing detectors decide them, as
before. None of the four is scored by the accuracy gate.

Judge sets (shipped file's own outputs, not run 7's, at its thresholds, scored the way the app reads a file):
animal sound .80/.93 on the free tag set (75 positives, precision a floor), tambourine 21/24 found with 0 of 376
explicit negatives firing, percussion recall .86 on the free tag set and .35 on the Drive judge half (weak
precision .18 and .30). Run 7's own judge-set numbers are not measured.

## Left out

Bell passes FSD50K (.71/.50, exactly at the bar) but finds 36% of the held-out VCSL bells, so it stays out. Air horn,
sub drop and other outputs that pass only on the generated Stable Audio clips or on NSynth renders stay out. The
other outputs run 7 improves miss on recall at their validation thresholds; a different threshold could be chosen
only by looking at the test sets, which this blend does not do.
