# Round A/B/C launch sheet (2026-10-31)

Plan: PR #260 (draft round plan). This branch builds it; **nothing here has been launched**. Every paid job below waits
for Chris's go. `SHA` is this branch's head commit (the PR body has it filled in).

Order: the two staging jobs and job C can run at once (all cpu-upgrade). Job A needs `birds/v1` staged; job B needs
`guitarfx/v1` staged. Staging only writes to the private dataset `cmjatom/dge-private-train` (each script refuses a
public target). A and B log to the Trackio space `cmjatom/dge-training-charts` (aggregate numbers only).

## Costs (HF Jobs list prices: cpu-upgrade $0.03/h, l4x1 $0.80/h)

| Job | Hardware | Timeout | Expected | Worst case |
|---|---|---|---|---|
| Stage birds (ff1010bird + Warblr10k, ~10.7 GB download) | cpu-upgrade | 2 h | ~$0.03 | $0.06 |
| Stage guitar fx (IDMT guitar + Medley-solos-DB, ~11 GB download) | cpu-upgrade | 2 h | ~$0.04 | $0.06 |
| C: CED check, electric piano + breakbeat (scores only) | cpu-upgrade | 1 h | ~$0.02 | $0.03 |
| A: birds fine-tune from run 1 | l4x1 | 3 h 30 m | ~$1.40-1.80 | $2.80 |
| B: guitar fx fine-tune from run 1 | l4x1 | 3 h 30 m | ~$1.40-1.80 | $2.80 |
| **Total** | | | **~$3.3** | **~$5.75** |

No job can pass $5 and the worst-case total stays under ~$6.

## Staging

```bash
HF_TOKEN=... python3 scripts/audio-model/hf-launch.py cpu-upgrade 2h \
  JOB_SCRIPT=hf-stage-job.sh REPO_SHA="$SHA" STAGE_SCRIPT=stage-birds.py \
  STAGE_ARGS="--repo cmjatom/dge-private-train --out birds/v1" JOB_NAME=dge-stage-birds-2026-10-31

HF_TOKEN=... python3 scripts/audio-model/hf-launch.py cpu-upgrade 2h \
  JOB_SCRIPT=hf-stage-job.sh REPO_SHA="$SHA" STAGE_SCRIPT=stage-guitarfx.py \
  STAGE_ARGS="--repo cmjatom/dge-private-train --out guitarfx/v1" JOB_NAME=dge-stage-guitarfx-2026-10-31
```

## Job C

```bash
HF_TOKEN=... python3 scripts/audio-model/hf-launch.py cpu-upgrade 1h \
  JOB_SCRIPT=hf-stage-job.sh REPO_SHA="$SHA" STAGE_SCRIPT=ced-check-keys-breaks.py \
  STAGE_ARGS="--repo cmjatom/dge-private-train --out ced/keys-breaks-2026-10-31" JOB_NAME=dge-round-c-ced-2026-10-31
```

### Job A
```bash
HF_TOKEN=... python3 scripts/audio-model/hf-launch.py l4x1 210m \
  REPO_SHA="$SHA" \
  HF_REPO=cmjatom/dge-sound-tag-candidate \
  INIT_FROM=cmjatom/dge-sound-tag-candidate@main/recall-push-r1 \
  POS_WEIGHT=2 \
  JOB_HOURS=3.5 \
  ALL_TAGS=1 \
  MODEL=mn20_as \
  EPOCHS=1 \
  LR=1e-4 \
  BATCH=64 \
  WEAK=0.2 \
  RARE_REPEAT=3 \
  TRAIN_HOURS=1.5 \
  ABSENT_FIX=cmjatom/dge-private-train:tagger-recall2/v1/recall2-labels.json \
  CHRIS_DATA=cmjatom/dge-private-train:chris-drive/train-v1 \
  FSNEW_DATA=cmjatom/dge-private-train:freesound/fsnew-v1 \
  RUN9_DATA=cmjatom/dge-private-train:run9/v1 \
  RUN9_AUDIT=cmjatom/dge-private-train:run9/v1-audit/manifest-audited.csv \
  R13_DATA=cmjatom/dge-private-train:tagger-r20/v1 \
  SOUNDCLOUD_DATA=cmjatom/dge-tagger-data:soundcloud-57f915a \
  IOWA=1 \
  RAWSTEMS=1 \
  RAWSTEMS_FX=0.25 \
  VCSL=1 \
  SLAKH_MORE=1 \
  SAO=1 \
  ROUND10=1 \
  ROUND12=0 \
  MERGE_ONLY=1 \
  PREP_ONLY=0 \
  SOURCE_REPEAT=iowa=2,vcsl=2,chrisdrive=4,chrisfx=2,fsnew=3 \
  NEG_TAGS='' \
  NEG_WEIGHT=1 \
  TRACKIO_SPACE=1 \
  BIRDS_DATA=cmjatom/dge-private-train:birds/v1 \
  RECALL_TAGS='bird ambience' \
  OUT_DIR=round-a-birds-2026-10-31 \
  JOB_NAME=dge-round-a-birds \
  TRACKIO_RUN='round A birds 2026-10-31'
```

### Job B
```bash
HF_TOKEN=... python3 scripts/audio-model/hf-launch.py l4x1 210m \
  REPO_SHA="$SHA" \
  HF_REPO=cmjatom/dge-sound-tag-candidate \
  INIT_FROM=cmjatom/dge-sound-tag-candidate@main/recall-push-r1 \
  POS_WEIGHT=2 \
  JOB_HOURS=3.5 \
  ALL_TAGS=1 \
  MODEL=mn20_as \
  EPOCHS=1 \
  LR=1e-4 \
  BATCH=64 \
  WEAK=0.2 \
  RARE_REPEAT=3 \
  TRAIN_HOURS=1.5 \
  ABSENT_FIX=cmjatom/dge-private-train:tagger-recall2/v1/recall2-labels.json \
  CHRIS_DATA=cmjatom/dge-private-train:chris-drive/train-v1 \
  FSNEW_DATA=cmjatom/dge-private-train:freesound/fsnew-v1 \
  RUN9_DATA=cmjatom/dge-private-train:run9/v1 \
  RUN9_AUDIT=cmjatom/dge-private-train:run9/v1-audit/manifest-audited.csv \
  R13_DATA=cmjatom/dge-private-train:tagger-r20/v1 \
  SOUNDCLOUD_DATA=cmjatom/dge-tagger-data:soundcloud-57f915a \
  IOWA=1 \
  RAWSTEMS=1 \
  RAWSTEMS_FX=0.25 \
  VCSL=1 \
  SLAKH_MORE=1 \
  SAO=1 \
  ROUND10=1 \
  ROUND12=0 \
  MERGE_ONLY=1 \
  PREP_ONLY=0 \
  SOURCE_REPEAT=iowa=2,vcsl=2,chrisdrive=4,chrisfx=2,fsnew=3 \
  NEG_TAGS='' \
  NEG_WEIGHT=1 \
  TRACKIO_SPACE=1 \
  GUITARFX_DATA=cmjatom/dge-private-train:guitarfx/v1 \
  RECALL_TAGS='distorted,electric guitar' \
  OUT_DIR=round-b-guitarfx-2026-10-31 \
  JOB_NAME=dge-round-b-guitarfx \
  TRACKIO_RUN='round B guitar fx 2026-10-31'
```


## Caveats

- IDMT guitar identity: the XML lists do not name the guitar. Settings 6/7 = guitar 1 and 8/9 = guitar 2 is an
  assumption. The data fits it: the mono zips use 6/7/8/9 evenly, and the poly zips (one take per guitar) use only 6 and 9.
- IDMT licence: Zenodo says CC BY-NC-ND 4.0; the bundled PDF says CC BY-SA 4.0. Treated as non-commercial, so B's
  weights stay CC BY-NC-SA. Medley-solos-DB is CC BY 4.0, and only its `test` subset (solosDb) is used.
- IDMT has an `EQ` folder that the dataset description does not list (1248 mono + 840 poly guitar clips). It is labelled
  guitar / electric guitar with every effect tag absent except `dry`, which is left unknown.
- The fresh held-out sets (guitar 2, the 46 Medley held-out songs, the bird held-out groups, the keys/breaks held-out
  uploaders) are staged inside the private `dge-private-train` and never trained on. The dge-training-data-rules skill
  says judge/test sets are never uploaded anywhere, including private repos. Chris should confirm that the job's own
  held-out split may live there, as earlier rounds' held-out splits did.
- Warblr10k has no recordist ids, so it is grouped per recording. ff1010bird is grouped by Freesound uploader.
- `datasets/commercial-split/packs.csv` is not in the repo, so no pack can be checked against it (the scripts log this).
- `INIT_FROM` points at `recall-push-r1` on `main` of the candidate repo and is not pinned to a revision.
- The free CPU electric-guitar head refit from PR #260's job B is not built.
- Job C local dry-run (2026-10-31, free, nothing written): breakbeat 241 train / 5 held-out confirmed; electric piano
  55 train / 0 held-out confirmed (11 held-out rejected), so the electric-piano held-out check will be weak. The BSD10k
  metadata could not be read (`sound_id` column missing), so held-out rows are not checked against BSD10k.
- Job C needs no GPU and finished locally in a few minutes, so it could also be run for free on the box instead of
  the ~$0.02 job.
