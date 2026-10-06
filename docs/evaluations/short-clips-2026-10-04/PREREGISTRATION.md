# Pre-registration: short-clip test usage

Written 2026-10-04 ~23:20 local, before the after-v1 test results were read.

- The frozen test split (`manifest.json`, SHA-256 `80bac013…`) has been used exactly twice:
  1. `baseline` — build of the working tree at 19:44 (before any short-clip change).
  2. `after-v1` — build with `public/sound-model/short-clip.json` revision `short-clip-2026-10-04-clapRepeat`.
- **after-v1 is the reported result.** Its heads, thresholds and feature choice were selected on development data only
  (uploader/preset/participant-grouped out-of-fold predictions over train + calibration).
- Any change made after reading after-v1 is selected on development data only, and is either reported as
  "adjusted after seeing test" or measured on a newly frozen set. Thresholds are not retuned on these test clips.

## Addendum (still before reading after-v1 results)

A final policy `v2` was decided without looking at after-v1 outcomes, for design reasons only:
1. On clips the one-shot heads cover, **every** looped-CLAP head is hidden (allowlist), not a fixed list. Reason: another
   session added 17 more looped heads at 22:43, none validated on one-shots; a list goes stale.
2. One-shot heads apply only up to **2.25 s**, the longest duration the benchmark measured (was 2.5 s).
3. Forced reanalysis after upgrade is limited to clips of 2.25 s or less (long songs are not re-run). The key/pitch revision
   bump is reverted: those short clips re-run anyway.
v2 will be measured with one more real-upload pass on the same frozen test split (third and final use). No thresholds,
heads or features are changed; after-v1 is still reported alongside it.

## Addendum 2026-10-05 (before any run of this change): tested-tag display fix

Diagnosis from code, not from test results: a tag from a tested one-shot head (e.g. `kick`, `voice`, `synth hit`) was
replaced by an untested model's tag for the same label whenever that model's score was higher (AST, Jamendo or CLAP
scores are on other scales), and a source copied from a tested type (kick → drums) was skipped whenever any untested
source tag already existed. The panel then hid the label, because only tested scores are shown on short clips.
Change: tags are ranked by how they were checked (reviewed examples > trained head > maybe head > untested), never by
raw score across models; a shown trained-head type always stands for its catalog source. No heads, thresholds or the
category map change.

Measurement plan, fixed now: `.github/workflows/short-clip-eval.yml` runs the base build (main `d1b7b05`) and this
build on the **calibration** split and on the **test** split, from audio refetched from public mirrors. The test split
was declared used up after v2, so its numbers from this run are reported as "measured after seeing test results".
The calibration split decides: the change ships only if no label that passes 60/60 on calibration with the base build
drops below it with this build.
