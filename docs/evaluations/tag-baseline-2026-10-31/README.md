# Tag baseline, 2026-10-31 (step 1 of the tag-accuracy push)

How well the app's current tagging does, per tag, on real uploaded sounds it never trained on. Every number here comes
from one run on 2026-10-31 (logs listed at the end).

## The set

- **681 clips from 430 Freesound uploaders**, taken from the **FSD50K eval split** (Hugging Face `Fhrozen/FSD50k`,
  revision `ccf1acaff12f3f4a4c10052dddafbb6d22152c9b`). Each clip keeps its own Creative Commons licence, listed in
  `manifest.csv`.
- **49 tags labelled** (of about 199). The labels come from the repo's own FSD50K-to-tag map
  (`scripts/audio-model/labelmap.py`). FSD50K eval labels are exhaustive, so a tag that is not listed counts as absent.
  The app path folds `vocal breath` into `breath` and gives no row for `turntable` or `vocal gasp`, so **46 tags are scored**.
- Selection is deterministic (`scripts/tag-baseline/build_set.py`, seed `dge-tag-baseline-2026-10-31`). Rarest tags are
  filled first, with up to 20 positives per tag and at most 3 clips per uploader. It then adds 150 clips that carry
  none of the mapped classes. Clips and uploaders reserved for the short-clip and synth test sets are skipped.
- Only IDs, labels and metadata are committed (`manifest.csv`, `items.json`). **No audio is in the repo.**
  `scripts/tag-baseline/fetch.sh` downloads the audio again from the pinned revision, outside the repo.

**Relabelled in step 2 (same day, after Chris defined drums as any drum sound):** `items.json` and `manifest.csv` now
also count FSD50K `Drum`, `Bass_drum`, `Snare_drum` and `Tabla` as drums. The 681 clips are the same; 29 gain a drums
label. The drums row below used the old labels (kit only); see `docs/evaluations/tag-fix-2026-10-31`.

**This is a judge set.** Evaluate on it only. Never train on it, pick thresholds on it, or upload its audio anywhere.
To tune in step 2, use the pick/check halves in the report, or a separate set.

## Method

The run uses `scripts/eval-tag.ts`, the existing app-path evaluator, with `--set items.json --audio-dir`. It runs:

- CLAP q8 on 10 s windows with a 5 s hop;
- the `learned.json` heads;
- the `short-clip.json` heads for clips of 2.25 s or less;
- the tagger at `public/tagger-model`;
- `confidentSoundSummary` for the shown/not-shown decision. A faded "maybe" tag counts as shown.

The first tag is the `--tag` target; the other 48 are passed as `--watch`, so they are measured at today's thresholds
with no sweep. AST, Jamendo and the long-recording event windows are not run. For clips of 10 s or more, recall for
drums and piano is therefore a lower bound.

```
scripts/tag-baseline/fetch.sh /tmp/dge-acc-data        # metadata + 681 wavs, 1 min 12 s
scripts/tag-baseline/run.sh   /tmp/dge-acc-data docs/evaluations/tag-baseline-2026-10-31 4
python3 scripts/tag-baseline/test_tag_baseline.py
```

**Runtime:** 4 min 3 s wall-clock on 4 shards (score 190 s, decide 53 s). Download time is separate.

## Results

| | precision | recall | F1 |
|---|---:|---:|---:|
| micro (all 46 tags pooled: tp 696, fp 448, fn 499) | 0.608 | 0.582 | 0.595 |
| macro (mean over 46 tags; a tag never shown counts precision 0) | 0.687 | 0.591 | 0.606 |

Tags clearing each bar: 60/30: **32**, 50/50: **30**, 60/60: **21**, 70/70: **10** (of 46).

The full table is in `per-tag.csv` and `per-tag.md`, sorted worst F1 first. `summary.json` has the totals.

## Caveats

- **Coverage:** only 46 of about 199 tags are scored. FSD50K has no classes for the rest (genres, synths, DJ effects,
  character words).
- **Precision depends on prevalence.** Most tags have about 20 positives among 681 clips, so precision here is not the
  precision a user sees on their own library. Compare tags with each other, and this run with later runs.
- **Inflated scores:** some old heads were refit on FSD50K eval (see `docs/evaluations/clean-retrain-2026-10-11`). Their
  rows are flagged and may score higher than they should.
- **Small support:** tabla has only 6 positives and tambourine 15.

## Logs (on the box that ran it)

- `/tmp/dge-acc-fetch.log`: download.
- `/tmp/dge-acc-probe.log`: 6-clip probe; app/Node parity max diff 4.99e-7.
- `/tmp/dge-acc-run.log`: full run.
- `/tmp/dge-acc-data/{score-*.log,decide.log,report.json,timing.txt}`: the run's own output.
