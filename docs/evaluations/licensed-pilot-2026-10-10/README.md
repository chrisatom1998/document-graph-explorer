# Licensed-audio pilot (2026-10-10)

Pilot from Chris's `DGE-training-sound-discovery.zip` and `DGE-98-label-training-sources.csv`: can clearly licensed
new audio raise DGE sound-tag accuracy? Three labels had enough licensed, new, source-disjoint audio for a pilot:
**bass guitar**, **foley hit** and **laser**.

**Result: nothing ships.** Bass guitar and foley hit miss 50% precision and 50% recall on the locked holdout on both
clip-length routes. Pilot laser clears 50/50 only on the 2.25 s route (1 of 2 positives) and misses it on longer clips,
and the current app's laser detector beats it on both routes, so it fails the "beats the current app" rule. No model, threshold, calibration list or
analysis revision changes in this PR. It adds the reproducible pipeline and this report.

## Data

Full manifests (not committed: they name reserved test sources) are in the project folder
`datasets/licensed-pilot/`: `accepted-2026-10-10.csv`, `rejected-2026-10-10.csv` (every package row, with a reason),
`sources-2026-10-10.json`, `negatives-cc0-freesound-2026-10-10.csv`, `dedupe-2026-10-10.json`, `holdout.json`,
`holdout.lock`.

- **Accepted: 791 files, all CC0**, each with original URL, creator, licence, source family, encoded and decoded
  SHA-256, duration, per-axis labels (source, sound type, synthesis, articulation, effect, rhythm), label evidence
  and fold group.
  - Karoryfer Big Little Bass (git pin `4e92bdf`): 440 bass guitar notes, 44 groups.
  - Kenney Impact and Sci-fi packs: 201 files.
  - rubberduck sfx_100_v2 and 50 retro: 150 files.
- **Label checks:** every positive was checked acoustically. Status is "auto-checked (not listened)"; nothing was
  reviewed by ear. Bass notes: YIN pitch matches the note name within 100 cents (440/440 pass). Laser: a pitch sweep
  of at least half an octave within 3 s (8 failed and became unknown). Foley hit: a sharp attack and a 6 dB decay
  (1 failed). File names alone never set a label.
- **Rejected: 4,109 package rows.** 2,133 quarantined (modularsamples), 1,496 VSCO-2-CE (same Versilian family as
  VCSL, deferred), 442 VCSL (already in tagger run 7, whose held-out VCSL folders are its test set), 17 known prior IDs
  or reserved uploaders, 13 already represented (EGFxSet, NSynth, TinySOL, Surge, FSD50K), 5 too thin, 3 preview-only.
  Two more were exact decoded duplicates. Non-commercial, Sampling+, unclear-rights and unverified third-party music
  rows were excluded, and Splice was not assumed to permit training.
- **Negatives:** 905 CC0 clips from the Hugging Face Freesound mirror (`benjamin-paine/freesound-laion-640k`), from
  751 uploaders, capped at 4 per uploader. Every exclusion set and dynamic uploader rule applies, plus run 7's
  candidate pool. Rows whose text mentions a pilot label are dropped.
- **Dedupe:** exact decoded PCM, CLAP cosine at least 0.98 to any holdout file, and cosine at least 0.995 across fold
  groups. Nothing matched.

## Locked holdout

The holdout has 1,455 free-tag-set files and was frozen before training (`holdout.lock` sha256
`9a59776e…7b7f`). It is source-disjoint from every training family.

| Label | Positives (of which 2.25 s or shorter) | Negatives |
|---|---|---|
| bass guitar | 40 (12) | 1,217 |
| foley hit | 40 (30) | 1,277 |
| laser | 13 (2) | 1,370 |

## Baseline: the exact current app

Main at `87639ef`, production build, files uploaded through "Add files" under opaque names in headless Chromium,
Full analysis mode. The Sounds panel tags were read with the app's own display code. All 1,455 files were scored
(6.2 h on 4 CPUs).

- **Strict** counts only "likely" tags that are not "maybe".
- **Shown** counts any displayed tag.

| Label | Route | Strict P / R | Shown P / R | Hedged on positives / negatives |
|---|---|---|---|---|
| bass guitar | 2.25 s or shorter | 1.00 / 0.25 | 1.00 / 0.25 | 0 / 0 |
| bass guitar | longer | – / 0.00 | – / 0.00 | 0 / 0 |
| foley hit | 2.25 s or shorter | – / 0.00 | – / 0.00 | 0 / 0 (no detector) |
| foley hit | longer | – / 0.00 | – / 0.00 | 0 / 0 (no detector) |
| laser | 2.25 s or shorter | – / 0.00 | 0.67 / 1.00 | 2 / 1 |
| laser | longer | – / 0.00 | 0.90 / 0.82 | 9 / 1 |

29 of the 40 bass guitar positives are shown as "bass" instead of "bass guitar". Since #193 (merged after this
baseline) laser shows as a normal tag, so its "shown" numbers are now what users see.

## Pilot detectors

The pilot detectors are CLAP logistic heads, the same form as `learned.json`. Each threshold maximises the smaller of
precision and recall out of fold (up to 5 folds, 3 for laser's 3 positive groups, grouped by recording, preset or pack).

Out-of-fold scores on the training data look excellent:

| Label | Precision | Recall |
|---|---|---|
| bass guitar | 1.00 | 1.00 |
| foley hit | 0.95 | 0.96 |
| laser | 0.60 | 0.80 |

On the holdout they do not carry over. Screen from the app's own CLAP embedding of each file's first 10 s
(`score_offline.py`). Every locked file is scored. Eight one-shots under 0.1 s, three of them foley hit positives,
are too short for that embedding script and count as never firing; the ceiling searches every observed score:

| Detector | Route | P / R at its threshold | False positives | Best min(P, R) at any threshold |
|---|---|---|---|---|
| pilot bass guitar | 2.25 s or shorter | – / 0.00 | 0 | 0.05 |
| pilot bass guitar | longer | 0.00 / 0.00 | 11 | 0.21 |
| pilot foley hit | 2.25 s or shorter | 0.19 / 0.33 | 44 | 0.20 (0.30 if the 3 skipped positives were all found) |
| pilot foley hit | longer | – / 0.00 | 0 | 0.28 |
| pilot laser | 2.25 s or shorter | 1.00 / 0.50 | 0 | 0.50 |
| pilot laser | longer | 1.00 / 0.09 | 0 | 0.83 |
| current laser | 2.25 s or shorter | 0.67 / 1.00 | 1 | 0.67 |
| current laser | longer | 0.90 / 0.82 | 1 | 0.82 |

The screen reproduces the real app's numbers for the current laser detector exactly (shown P/R above), so it agrees
with the full app on this holdout. For bass guitar and foley hit, even the best threshold picked on the holdout itself
stays far under 50/50 (bass guitar 0.21, foley hit 0.30 at best). No bass guitar or foley hit detector the training data could produce would ship, so the full-app run of the candidate
build was stopped part-way. The pilot laser is worse than the current one on both routes.

**Against the bars:**

| Bar | Detectors that clear it |
|---|---|
| 50/50 (ship) | no pilot detector; the current laser does under "shown" scoring (strict: 0, because it was a "maybe" tag at baseline; #193 has since made it a normal tag, so "shown" is what users now see) |
| 70/70 | no pilot detector; the current laser does under "shown" scoring on longer clips (2 short positives only) |
| 90/90 | none |

## Why, and the data gaps

- **bass guitar:** all 440 positives are one instrument (Karoryfer Big Little Bass), single sustained DI notes,
  none short. Holdout bass guitar is played lines, loops and one-shots from many players. The head learned that one
  instrument. A real gain needs many basses, players, pickups and amps, played phrases, and short plucks. No CC0
  source in the package has that.
- **foley hit:** positives are game sound effects (Kenney, rubberduck), mostly synthetic or heavily processed.
  Holdout foley hits are real recorded impacts. The pilot fires on many other short sounds (44 false positives on
  short clips). This needs real recorded foley from many recordists.
- **laser:** 15 positives from 3 groups is too few. The current detector, trained on more varied lasers, is better.

## Speed, memory, download size

Nothing ships, so runtime, memory and download size are unchanged. For reference, the candidate build added 2 heads
and replaced 1. That grew `learned.json` by 9.9 KB raw (3.9 KB gzip), with no measurable per-file cost: three more
512-wide dot products per window.

## Commands

Scratch paths are illustrative. The holdout audio is the private free-tag-set and is never uploaded.

```sh
python3 -I scripts/licensed-pilot/build_manifest.py <package dir> <download dir> <manifest dir>
python3 -I scripts/licensed-pilot/negatives_from_mirror.py <exclusions> <no-source candidates.csv> <out> <mirror shards...>
python3 -I scripts/licensed-pilot/holdout.py <free-tag-set> <holdout dir>   # writes holdout.json + holdout.lock
THREADS=4 node scripts/embed-clap.mjs ...                                    # accepted, negatives, holdout
python3 -I scripts/licensed-pilot/dedupe.py ...
python3 -I scripts/licensed-pilot/train_heads.py <heads dir> <emb.jsonl,...> <manifests...>
scripts/licensed-pilot/run_app.sh <dist> <holdout.json> <free-tag-set> <out> 2   # real app, baseline
python3 -I scripts/licensed-pilot/score_offline.py <holdout.json> <holdout.jsonl> <heads.json> <learned.json> <out.json>
python3 -I scripts/licensed-pilot/apply_heads.py <heads.json> <plan.json>   # only for a head that clears the bar
```

`results.json` has the baseline app scores (strict and shown, per route, with false positives, misses, abstentions
and how often each tag fires on unlabelled files), the offline screen, out-of-fold training scores and the manifest
summary.
