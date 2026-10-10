# Licensed-audio pilot, round two (2026-10-10)

Round one (`docs/evaluations/licensed-pilot-2026-10-10/`) showed why its bass guitar and foley hit detectors failed:
one DI bass and game sound effects do not look like real recordings. Round two trains on real recordings from many
Freesound uploaders and judges on the same locked holdout (`holdout.lock` sha256 `9a59776e…7b7f`, 1,455 files from
SampleRadar, Iowa MIS and BBC SFX; never trained on or uploaded).

**Result: bass guitar ships on clips of 2.25 s or shorter.** The real app, run on the locked holdout, goes from
1.00 precision / 0.25 recall to **0.85 / 0.92** (11 of 12 positives, 2 false positives in 543 negatives). Nothing else
it displays changes on those clips. On longer clips the same detector would reach only 0.47 precision, so it is
placed in `short-clip.json`, which the app applies only to clips of at most 2.25 s; longer clips keep today's analysis.
Foley hit and laser do not change.

## Data

Manifests are in the project folder `datasets/licensed-pilot/round2-2026-10-10/` (not committed: they list scratch
paths and the plan rows). Every clip is from the Hugging Face Freesound mirror (`benjamin-paine/freesound-laion-640k`),
first 10 s, mono 48 kHz, with the Freesound URL, uploader, licence, encoded and decoded SHA-256 and label evidence.

| Set | Clips | Uploaders | How the label was set |
|---|---|---|---|
| bass guitar positives | 119 | 37 | CED-base "Bass guitar" at least 0.3 and the uploader's title or tags name a bass, with no synth, 808, sub, upright or double bass word |
| foley hit positives | 302 | 225 | best CED impact class (slam, knock, thump, bang, smash...) at least 0.5, and the text names an impact, with no drum, music or loop word |
| low sounds that are not a bass guitar | 119 | 88 | CED "Bass guitar" under 0.1, a double bass, guitar, bass drum, synthesizer or cello class at least 0.6, and the text names that sound and no bass guitar |
| drum loops with no bass | 314 | 189 | a CED drum class at least 0.6, "Bass guitar" under 0.05, and the text names drums or a beat and no bass |
| round one negatives | 904 | 750 | unchanged (CC0, no pilot label named) |

- Two signals set every label, the AudioSet model's score and the uploader's own words; nothing was reviewed by ear
  ("auto-checked (not listened)"). The text check rejected 73 bass, 298 foley, 191 low-sound and 86 drum candidates.
- Licence: CC0, CC BY 4.0 or CC BY 3.0 only, so the shipped weights carry no non-commercial term. Chris's
  any-licence rule (2026-10-10) would also allow the 46 non-commercial bass and 152 non-commercial foley candidates;
  they were not needed.
- Exclusions: the DGE exclusion manifest's held-out and reserved Freesound ids and uploaders, its three dynamic
  held-out uploader rules, and the held-out rows of tagger runs 7 and 9. The manifest's "prior" sets only mark audio
  that is not new, so round two may reuse it. That still barred 462 bass and 563 foley candidates.
- Dedupe (`dedupe.py`): no clip matched the holdout's decoded PCM or came within CLAP cosine 0.98 of a holdout file.
- Getting only these clips: the mirror is about 780 GB, so `positives_from_mirror.py fetch` reads only the parquet
  row groups that hold a planned clip, over HTTP range requests, and keeps no shard.

## Detectors and how one was chosen

CLAP logistic heads as in round one (`train_heads.py`, threshold from grouped out-of-fold scores, never from the
holdout). Round one's Karoryfer bass and Kenney/rubberduck effects were left out because they had made the heads worse.
Three bass guitar heads were trained in turn, and each was screened on the holdout (`score_offline.py`, all 10 s windows):

| Head | Extra negatives | 2.25 s or shorter P / R | Longer P / R | Longer false positives |
|---|---|---|---|---|
| A | none | 0.60 / 1.00 | 0.36 / 0.96 | 49 |
| **A2 (shipped)** | low sounds that are not a bass guitar | **0.85 / 0.92** | 0.47 / 0.96 | 31 |
| A3 | A2 plus drum loops | 0.60 / 1.00 | 0.29 / 0.96 | 66 |

Because A2 was picked after seeing these three screens, its holdout numbers are somewhat optimistic. All three clear
50/50 on short clips and beat today's detector there (F1 0.75 to 0.88 against 0.40). None clears 50/50 on longer
clips, which is why the head goes to `short-clip.json` only.

Foley hit stays as it is: the best of these heads reaches 0.31 / 0.53 on short clips (best min(P, R) at any threshold
0.40) and 0.13 / 0.10 on longer ones, although its out-of-fold scores on the training data were 0.89 / 0.89. Only
111 of the 302 foley clips are 2.25 s or shorter, against 30 of the holdout's 40 positives, so the next step is
short, cleanly cut foley one-shots.

## Real-app check

`apply_short_clip_head.py` converts the head exactly: short-clip.json standardises the same CLAP embedding with its
stored mean and std, so `w' = w * std` and `b' = b + w . mean` give the same score (largest logit difference over the
holdout's short clips: 9e-16). The candidate build was run through `run_app.sh` on the 594 holdout clips of at most
2.25 s (74 min on 4 CPUs; one partial result was rerun alone). Longer clips are unaffected by short-clip.json, so the
baseline's results for them were reused.

| Label | Route | Today (strict = shown) | With the new head |
|---|---|---|---|
| bass guitar | 2.25 s or shorter | 1.00 / 0.25, F1 0.40 | **0.85 / 0.92, F1 0.88** |
| bass guitar | longer | – / 0.00 | unchanged |

Against the bars on short clips: 50/50 and 70/70 cleared; 90/90 not (precision 0.85). Across all 594 short clips the
only change in what the app shows is 10 more "bass guitar" tags (11 true positives, up from 3; false positives 0 to 2).

## Speed, memory, download size

One existing short-clip head's weights are replaced: same dot product, no new model or window. `short-clip.json`
grows from 107.5 KB to 111.6 KB raw (39.1 KB to 41.3 KB gzip) because the converted weights carry full precision.
`INSTRUMENT_ANALYSIS_REVISION` moves to 91/92, so stored analyses refresh their bass guitar score.

## Commands

```sh
python3 -I scripts/licensed-pilot/positives_from_mirror.py select <ced run dir> <exclusion-manifest.json> \
  <run 7 candidates.csv> <run 9 keyword.csv> <out>
python3 -I scripts/licensed-pilot/positives_from_mirror.py fetch <out> 8
THREADS=4 node scripts/embed-clap.mjs <clips.json> <emb.jsonl>
python3 -I scripts/licensed-pilot/dedupe.py <holdout.json> <free-tag-set> <emb.jsonl,...> <out> <manifests...>
python3 -I scripts/licensed-pilot/train_heads.py <heads dir> <emb.jsonl,...> <negatives.csv> <positives.csv> <hard-negatives.csv>
python3 -I scripts/licensed-pilot/score_offline.py <holdout.json> <holdout.jsonl> <heads.json> <learned.json> <out.json> <windows.jsonl>
python3 -I scripts/licensed-pilot/apply_short_clip_head.py <heads.json> "bass guitar" <revision tag>
scripts/licensed-pilot/run_app.sh <dist> <short-clip holdout subset> <free-tag-set> <out> 2
python3 -I scripts/licensed-pilot/score_app.py <holdout.json> <out.json> <baseline ui-tags...> <candidate short ui-tags...>
```

`results.json` has the app scores before and after, the three screens and the training summary.
