#!/usr/bin/env bash
# Train DGE's own instrument tagger on a Hugging Face Jobs GPU (launched by .github/workflows/audio-model-train.yml).
# Fetches every dataset itself (nothing is uploaded from GitHub), trains, calibrates on validation artists, exports the
# browser model, scores DJ clip rounds 1 and 2 and the round 3 held-out Jamendo set (aggregates only), and uploads the
# run to the private model repo $HF_REPO. Env: REPO_SHA, HF_REPO, MODEL, EPOCHS, LR, BATCH, WEAK, optional RARE_REPEAT, JOB_HOURS, SOUNDCLOUD_DATA, TRACKIO_SPACE, HF_TOKEN (secret).
# ALL_TAGS=1 adds the app-named head (FSD50K dev, NSynth train + effect renders, Freesound; judged on FSD50K eval, NSynth
# test and held-out Freesound uploaders), plus TinySOL, EGFxSet, FSLD, WaivOps drum loops, Surge presets (prepare-extra.py)
# and Slakh stems when scripts/audio-model/prepare-slakh.py exists. RAWSTEMS=1 adds Mixing Secrets songs (non-commercial).
# INIT_FROM=<model repo>[@<revision>[/<folder>]] starts from an earlier run's model.pt. OUT_DIR puts this run under a folder of $HF_REPO.
# Run 7 additions (all optional): RAWSTEMS_FX=<share> re-renders that share of the Mixing Secrets windows with one effect
# (source rsfx); IOWA=1 adds University of Iowa MIS notes minus the free-tag-set judge notes (prepare-iowa.py);
# CHRIS_DATA=<private dataset>:<folder> adds Chris's own train-half sounds and effect renders of them (prepare-chrisdrive.py;
# staged by stage-chrisdrive.py; non-commercial weights; never leaves the private repos); SOURCE_REPEAT=name=k,... oversamples
# sources (train.py --repeat). The run folder gets data-manifest.json naming every source and every chris-drive file used.
# VCSL=1 adds VCSL CC0 one-shots and scores its held-out folders (eval-vcsl); SLAKH_MORE=1 adds the Slakh train tracks after
# the cached 600 that carry rare orchestral or mallet patches (prepare-slakh-more.py); SAO=1 adds the private Stable Audio Open
# effect clips (prepare-sao.py) and scores their held-out prompt groups (eval-sao); FSNEW_DATA=<private dataset>:<folder> adds the
# staged Freesound sounds for tags with little or no audio (stage-freesound.py, prepare-fsnew.py) and scores their heldout rows (eval-fsnew).
# Run 9: RUN9_DATA=<private dataset>:<folder> adds the staged run 9 audio (stage-run9.py, prepare-run9.py: Freesound keyword and
# CED-base checked rows, labelled sets, code renders; unreviewed) and scores its held-out split (eval-run9).
# RUN9_AUDIT=<private dataset>:<path of manifest-audited.csv> (run9-audit.py) keeps only the audited items.
# ROUND10=1 adds the round 10 commercial training packs from the private bucket cmjatom/dge-commercial-train (prepare-round10.py).
# ROUND12=1 (round12/round12.json): adds the empty-tag train audio (private cmjatom/dge-private-train empty-tags/v1, prepared
# by prepare-run9.py as etfs9/etls9, no renders), the extra look-alike groups, oversampling of the target tags (--rare-tags,
# RARE_REPEAT times) and any approved merges (--merge); and stops before training if a training row is an FSD50K eval clip.
set -euo pipefail
START=$(date +%s)
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get install -yq --no-install-recommends ffmpeg git ca-certificates curl > /dev/null
pip install -q scikit-learn scipy pyarrow onnx onnxruntime huggingface_hub
# Round 11: SOFT_LABELS=<private dataset>:<path> adds the teacher's soft labels (round11/build-soft.py); fetched first,
# while the job's access token is fresh.
if [ -n "${SOFT_LABELS:-}" ]; then
  python3 -c "import sys, shutil; from huggingface_hub import hf_hub_download as d; r, f = sys.argv[1].split(':'); shutil.copy(d(r, f, repo_type='dataset'), '/tmp/soft-labels.json')" "$SOFT_LABELS"
fi
# Coverage #2: ABSENT_FIX=<private dataset>:<path> (coverage/merge-absent.py output) ignores likely-wrong weak absences,
# adds confident missed positives and applies the coverage sets' sure absences (train.py --absent-fix). Off by default.
if [ -n "${ABSENT_FIX:-}" ]; then
  python3 -c "import sys, shutil; from huggingface_hub import hf_hub_download as d; r, f = sys.argv[1].split(':'); shutil.copy(d(r, f, repo_type='dataset'), '/tmp/absent-fix.json')" "$ABSENT_FIX"
fi
# TRACKIO_SPACE=<user>/<space> turns on live training charts in that private Space (charts.py): training loss and
# validation mAP only, never held-out per-clip results. Unset by default.
if [ -n "${TRACKIO_SPACE:-}" ]; then pip install -q trackio==0.42.0 || echo "live charts off: trackio install failed"; fi
W=/work; mkdir -p $W && cd $W
git clone -q https://github.com/chrisatom1998/document-graph-explorer.git dge && git -C dge checkout -q "$REPO_SHA"
git clone -q https://github.com/fschmid56/EfficientAT.git && git -C EfficientAT checkout -q a425fdce92572e602a1d5634799bd9f1f2efa806
export EFFICIENTAT=$W/EfficientAT
S=$W/dge/scripts/audio-model
# Eval manifests from their own PRs, pinned: DJ clip round 2 (#119) and the round 3 held-out set (#121).
GH=https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer
mkdir -p manifests
curl -fsSL --retry 6 -o manifests/round2.json $GH/61cd34513011763468338f2d27e22a6c8b240648/docs/evaluations/dj-clips-round2-2026-10-06/openmic-manifest.json
curl -fsSL --retry 6 -o manifests/holdout-r3-jamendo.json $GH/f0f4de73246bd731435cc1f830f91d8b3145e893/docs/evaluations/holdout-r3-2026-10-06/jamendo-manifest.json
cp $W/dge/docs/evaluations/dj-clips-2026-10-06/openmic-manifest.json manifests/round1.json
nvidia-smi --query-gpu=name,memory.total --format=csv || true
nproc; free -g | head -2; df -h $W | tail -1

# Prepared data is cached in the private dataset <user>/dge-tagger-data under prep-cache/<key>, keyed by the prepare
# scripts and label map, so a rerun with the same data skips the ~3 h prep. The upload runs alongside training.
DIRS="prep prepj holdout"; [ "${ALL_TAGS:-0}" = 1 ] && DIRS="$DIRS fsdprep nsprep fsprep xprep"
# The run 7+ sources are cached separately, one by one (below), so their scripts stay out of this key.
KEY=$( (ls $S/prepare*.py | grep -v -e prepare-rawstems.py -e prepare-iowa.py -e prepare-chrisdrive.py -e prepare-vcsl.py -e prepare-slakh-more.py -e prepare-sao.py -e prepare-fsnew.py -e prepare-run9.py -e prepare-round10.py | xargs cat; cat $S/labelmap.py; echo "$DIRS") | sha256sum | cut -c1-12)
# The run 7+ sources below are cached one by one under prep-cache/src/<name>/<key> of the same private dataset (prep-cache.py):
# the key covers the source's prepare script, the local modules and files it uses, its output-changing arguments and a
# content hash of its private input, so a source is only rebuilt when one of those changed. Built sources are uploaded once
# every prep is done, alongside training. PREP_ONLY=1 stops after the uploads (a cheap job that fills the cache for the next run).
export S
from_cache() {   # <name> <dir> <prepare script> [prep-cache.py key options]: restore <dir> from the cache, or note its key and fail
  local name=$1 dir=$2 key; shift 2
  key=$(python3 $S/prep-cache.py key "$@") || { echo "$name: no prep cache key; preparing from scratch"; return 1; }
  echo "$key" > "$name.cachekey"
  python3 $S/prep-cache.py get "$name" "$key" "$dir" || return 1
  echo "$name: prepared data from the private prep cache ($key)"; cat "$dir/prep.log" 2>/dev/null || true
}
to_cache() {   # <name> <dir> <log>: queue a freshly built <dir> (with its log) for upload
  [ -f "$1.cachekey" ] || return 0
  cp "$3" "$2/prep.log"; echo "$1 $(cat "$1.cachekey") $2" >> cache-todo.txt
}
# RAWSTEMS=1 adds Mixing Secrets full songs (prepare-rawstems.py, non-commercial licence), built alongside the rest.
RS_PID=
if [ "${RAWSTEMS:-0}" = 1 ]; then
  ( from_cache rawstems rsprep prepare-rawstems.py --arg "fx=${RAWSTEMS_FX:-0}" \
    || { python3 $S/prepare-rawstems.py rsprep --workers 16 --fx "${RAWSTEMS_FX:-0}" && to_cache rawstems rsprep rawstems.log; } ) > rawstems.log 2>&1 & RS_PID=$!
fi
IOWA_PID=
if [ "${IOWA:-0}" = 1 ]; then
  ( from_cache iowa iowaprep prepare-iowa.py || { python3 $S/prepare-iowa.py iowaprep --workers 16 && to_cache iowa iowaprep iowa.log; } ) > iowa.log 2>&1 & IOWA_PID=$!
fi
VCSL_PID=
if [ "${VCSL:-0}" = 1 ]; then
  ( from_cache vcsl vcslprep prepare-vcsl.py || { python3 $S/prepare-vcsl.py vcslprep --workers 16 && to_cache vcsl vcslprep vcsl.log; } ) > vcsl.log 2>&1 & VCSL_PID=$!
fi
SM_PID=
SAO_PID=
if [ "${SAO:-0}" = 1 ]; then
  ( from_cache sao saoprep prepare-sao.py --data cmjatom/dge-effects-sao:sao || { python3 $S/prepare-sao.py saoprep && to_cache sao saoprep sao.log; } ) > sao.log 2>&1 & SAO_PID=$!
fi
if [ "${SLAKH_MORE:-0}" = 1 ]; then
  ( from_cache slakhmore smprep prepare-slakh-more.py || { python3 $S/prepare-slakh-more.py smprep --workers 8 && to_cache slakhmore smprep slakhmore.log; } ) > slakhmore.log 2>&1 & SM_PID=$!
fi
CD_PID=
if [ -n "${CHRIS_DATA:-}" ]; then   # private staged copy of Chris's train half: only counts are printed
  ( from_cache chrisdrive cdprep prepare-chrisdrive.py --data "$CHRIS_DATA" \
    || { python3 -c "import sys; from huggingface_hub import snapshot_download as d; r, f = sys.argv[1].split(':'); d(r, repo_type='dataset', allow_patterns=[f + '/*'], local_dir='cdstage', max_workers=8)" "$CHRIS_DATA" \
    && python3 $S/prepare-chrisdrive.py "cdstage/${CHRIS_DATA#*:}" cdprep && rm -rf cdstage && to_cache chrisdrive cdprep chrisdrive.log; } ) > chrisdrive.log 2>&1 & CD_PID=$!
fi
FN_PID=
if [ -n "${FSNEW_DATA:-}" ]; then   # private staged Freesound sounds for tags with little or no training audio (stage-freesound.py)
  ( from_cache fsnew fnprep prepare-fsnew.py --data "$FSNEW_DATA" \
    || { python3 -c "import sys; from huggingface_hub import snapshot_download as d; r, f = sys.argv[1].split(':'); d(r, repo_type='dataset', allow_patterns=[f + '/*'], local_dir='fnstage', max_workers=16)" "$FSNEW_DATA" \
    && python3 $S/prepare-fsnew.py "fnstage/${FSNEW_DATA#*:}" fnprep && rm -rf fnstage && to_cache fsnew fnprep fsnew.log; } ) > fsnew.log 2>&1 & FN_PID=$!
fi
RN_PID=
R10_PID=
LOOKALIKES=; LOOK_KEY=
if [ "${ROUND12:-0}" = 1 ]; then   # round 12's extra look-alike groups change run 9's prepared labels, so they are part of its cache key
  LOOKALIKES=$S/round12/round12.json; LOOK_KEY=$(python3 -c "import json, sys; print(json.dumps(json.load(open(sys.argv[1]))['lookalikes']))" $LOOKALIKES | sha256sum | cut -c1-16)
fi
if [ -n "${RUN9_DATA:-}" ]; then   # private staged run 9 audio (stage-run9.py): Freesound keyword / CED rows and labelled sets
  ( from_cache run9 r9prep prepare-run9.py --data "$RUN9_DATA" ${RUN9_AUDIT:+--data "$RUN9_AUDIT"} ${LOOKALIKES:+--arg "lookalikes=$LOOK_KEY"} \
    || { python3 -c "import sys; from huggingface_hub import snapshot_download as d; r, f = sys.argv[1].split(':'); d(r, repo_type='dataset', allow_patterns=[f + '/*'], local_dir='r9stage', max_workers=16)" "$RUN9_DATA" \
    && if [ -n "${RUN9_AUDIT:-}" ]; then python3 -c "import sys, shutil; from huggingface_hub import hf_hub_download as d; r, f = sys.argv[1].split(':'); shutil.copy(d(r, f, repo_type='dataset'), 'run9-audited.csv')" "$RUN9_AUDIT"; fi \
    && python3 $S/prepare-run9.py "r9stage/${RUN9_DATA#*:}" r9prep --workers 6 ${RUN9_AUDIT:+--audit run9-audited.csv} ${LOOKALIKES:+--lookalikes $LOOKALIKES} && rm -rf r9stage && to_cache run9 r9prep run9.log; } ) > run9.log 2>&1 & RN_PID=$!
fi
CACHE_PID=
if python3 - "$KEY" $DIRS <<'PY'
import os, shutil, sys
from huggingface_hub import HfApi, snapshot_download
key, dirs = sys.argv[1], sys.argv[2:]
try:
    api = HfApi(); repo = api.whoami()['name'] + '/dge-tagger-data'; base = f'prep-cache/{key}'
    if not api.file_exists(repo, f'{base}/DONE', repo_type='dataset'): sys.exit(1)
    if os.environ.get('PREP_ONLY') == '1': print(f'prep only: {repo}/{base} is already cached'); sys.exit(0)
    snapshot_download(repo, repo_type='dataset', allow_patterns=[f'{base}/*'], local_dir='cache', max_workers=16)
    for d in dirs: shutil.move(f'cache/{base}/{d}', d)
    print(f'using cached prepared data {repo}/{base}')
except SystemExit: raise
except Exception as e:
    print(f'prep cache unavailable ({e}); preparing from scratch'); [shutil.rmtree(d, True) for d in dirs]; sys.exit(1)
PY
then echo "data from cache took $(( ($(date +%s) - START) / 60 )) min"
else
  JM=https://raw.githubusercontent.com/MTG/mtg-jamendo-dataset/cafd8e20c265ed84f1e61f1c875327971f43a62f
  for f in data/raw_30s_cleantags.tsv data/splits/split-0/autotagging_instrument-train.tsv data/splits/split-0/autotagging_instrument-validation.tsv \
           data/splits/split-0/autotagging_instrument-test.tsv \
           derived/music-classification-annotations/music-classification-annotations-clean.tsv data/download/raw_30s_audio-low_sha256_tracks.txt; do
    mkdir -p mj/$(dirname $f); curl -fsSL --retry 6 -o mj/$f $JM/$f
  done
  ( curl -fsSL --retry 6 -o openmic.tgz "https://zenodo.org/records/1432913/files/openmic-2018-v1.0.0.tgz?download=1"
    echo "e4ccf187e2bb5ab2e115416e8aafe7f4  openmic.tgz" | md5sum -c -
    python3 $S/prepare.py openmic.tgz prep manifests/round1.json manifests/round2.json && rm openmic.tgz ) > openmic.log 2>&1 &
  python3 $S/prepare-jamendo.py mj manifests/holdout-r3-jamendo.json prepj --windows 2 --parallel 6 > jamendo.log 2>&1 &
  python3 $S/prepare-holdout.py manifests/holdout-r3-jamendo.json mj/data/download/raw_30s_audio-low_sha256_tracks.txt holdout/holdout-r3 > holdout.log 2>&1 &
  if [ "${ALL_TAGS:-0}" = 1 ]; then
    python3 $S/prepare-fsd50k.py fsdprep --workers 32 > fsd50k.log 2>&1 &
    python3 $S/prepare-nsynth.py nsprep --workers 4 > nsynth.log 2>&1 &
    python3 $S/prepare-freesound.py fsprep > freesound.log 2>&1 &
    for x in tinysol egfx fsld waivops surge; do python3 $S/prepare-extra.py $x xprep > $x.log 2>&1 & done
    if [ -f $S/prepare-slakh.py ]; then python3 $S/prepare-slakh.py xprep > slakh.log 2>&1 & fi
  fi
  LOGS=$(ls *.log | grep -v -e rawstems.log -e iowa.log -e chrisdrive.log -e vcsl.log -e slakhmore.log -e sao.log -e fsnew.log -e run9.log -e round10.log)
  # The raw-stems, Iowa and chris-drive preps are waited on (and their logs shown) separately below.
  for job in $(jobs -p); do case " ${RS_PID:-} ${IOWA_PID:-} ${CD_PID:-} ${VCSL_PID:-} ${SM_PID:-} ${SAO_PID:-} ${FN_PID:-} ${RN_PID:-} " in *" $job "*) continue;; esac; wait $job || { tail -n 20 $LOGS; exit 1; }; done
  tail -n 3 $LOGS; echo "data prep took $(( ($(date +%s) - START) / 60 )) min"; df -h $W | tail -1
  python3 - "$KEY" $DIRS > cache-upload.txt 2>&1 <<'PY' &
import sys
from huggingface_hub import HfApi
key, dirs = sys.argv[1], sys.argv[2:]
api = HfApi(); repo = api.whoami()['name'] + '/dge-tagger-data'; base = f'prep-cache/{key}'
api.create_repo(repo, repo_type='dataset', private=True, exist_ok=True)
for d in dirs: api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=d, path_in_repo=f'{base}/{d}', commit_message=f'Prepared data {key}: {d}')
api.upload_file(path_or_fileobj=b'ok', path_in_repo=f'{base}/DONE', repo_id=repo, repo_type='dataset', commit_message=f'Prepared data {key} complete')
print(f'cached prepared data at {repo}/{base}')
PY
  CACHE_PID=$!
fi

EXTRA=()
if [ -n "$RS_PID" ]; then wait $RS_PID || { tail -n 30 rawstems.log; exit 1; }; tail -n 5 rawstems.log; EXTRA+=(--extra rawstems=rsprep); fi
[ -f rsprep/rsfx.json ] && EXTRA+=(--extra rsfx=rsprep)
if [ -n "$IOWA_PID" ]; then wait $IOWA_PID || { tail -n 30 iowa.log; exit 1; }; tail -n 4 iowa.log; EXTRA+=(--extra iowa=iowaprep); fi
if [ -n "$CD_PID" ]; then wait $CD_PID || { tail -n 5 chrisdrive.log; exit 1; }; tail -n 4 chrisdrive.log; EXTRA+=(--extra chrisdrive=cdprep --extra chrisfx=cdprep); fi
if [ -n "$VCSL_PID" ]; then wait $VCSL_PID || { tail -n 30 vcsl.log; exit 1; }; tail -n 5 vcsl.log; EXTRA+=(--extra vcsl=vcslprep); fi
if [ -n "$SM_PID" ]; then wait $SM_PID || { tail -n 30 slakhmore.log; exit 1; }; tail -n 2 slakhmore.log; EXTRA+=(--extra slakhmore=smprep); fi
if [ -n "$SAO_PID" ]; then wait $SAO_PID || { tail -n 30 sao.log; exit 1; }; tail -n 2 sao.log; EXTRA+=(--extra sao=saoprep); fi
if [ -n "$FN_PID" ]; then wait $FN_PID || { tail -n 30 fsnew.log; exit 1; }; tail -n 3 fsnew.log; EXTRA+=(--extra fsnew=fnprep); fi
if [ -n "$RN_PID" ]; then wait $RN_PID || { tail -n 30 run9.log; exit 1; }; tail -n 4 run9.log; EXTRA+=(--extra fs9=r9prep --extra ls9=r9prep); fi
if [ "${ROUND12:-0}" = 1 ]; then   # round 12: empty-tag train audio, staged train-only (test filtering ran in the project container)
  GUARD=(etguard)   # the FSD50K eval check reads the lists this job actually trains on
  if [ -n "${RUN9_DATA:-}" ]; then
    [ -n "${RUN9_AUDIT:-}" ] || { echo "stopping: round 12 trains run 9 audio only from an audited list (set run9_audit) so the FSD50K check covers it"; exit 1; }
    python3 -c "import sys, shutil; from huggingface_hub import hf_hub_download as d; r, f = sys.argv[1].split(':'); shutil.copy(d(r, f, repo_type='dataset'), 'r9-guard.csv')" "$RUN9_AUDIT"
    GUARD+=(r9-guard.csv)
  fi
  python3 -c "from huggingface_hub import snapshot_download as d; d('cmjatom/dge-private-train', repo_type='dataset', allow_patterns=['empty-tags/v1/*/manifest.csv', 'empty-tags/v1/*/*/manifest.csv'], local_dir='etguard')"
  python3 $S/round12/check-fsd50k-eval.py "${GUARD[@]}" || exit 1   # runs on every job, cache hit or not
  if ! from_cache emptytags etprep prepare-run9.py --data cmjatom/dge-private-train:empty-tags/v1 --arg "prefix=et no-renders" --arg "lookalikes=$LOOK_KEY" > emptytags.log 2>&1; then
    python3 -c "from huggingface_hub import snapshot_download as d; d('cmjatom/dge-private-train', repo_type='dataset', allow_patterns=['empty-tags/v1/*'], local_dir='etdl', max_workers=16)"
    mkdir -p etstage; for m in $(find etdl/empty-tags/v1 -name manifest.csv); do d=$(dirname $m); mv "$d" "etstage/$(echo ${d#etdl/empty-tags/v1/} | tr / -)"; done
    python3 $S/prepare-run9.py etstage etprep --workers 6 --prefix et --no-renders --lookalikes $LOOKALIKES >> emptytags.log 2>&1 || { tail -n 30 emptytags.log; exit 1; }
    rm -rf etdl etstage; to_cache emptytags etprep emptytags.log
  fi
  tail -n 3 emptytags.log; ET_PID=done; EXTRA+=(--extra etfs9=etprep --extra etls9=etprep)
  RARE_TAGS=bass,organ,cello,trumpet,violin,saxophone,$(python3 -c "import json, sys; print(','.join(json.load(open(sys.argv[1]))['oversample']))" $S/round12/round12.json)   # train.py's default rare classes stay
fi
if [ "${ROUND10:-0}" = 1 ]; then   # round 10 commercial training packs, private bucket (prepare-round10.py; train list filtered for test
  # overlap beforehand). Runs after the other preps, not beside them: all of them at once ran an L4 job out of memory.
  if ! from_cache round10 r10prep prepare-round10.py --bucket-file cmjatom/dge-commercial-train:commercial-train/round10/train-list.csv > round10.log 2>&1; then
    python3 $S/prepare-round10.py cmjatom/dge-commercial-train commercial-train r10prep >> round10.log 2>&1 || { tail -n 30 round10.log; exit 1; }
    to_cache round10 r10prep round10.log
  fi
  tail -n 3 round10.log; R10_PID=done; EXTRA+=(--extra round10=r10prep)
fi
echo "all data ready after $(( ($(date +%s) - START) / 60 )) min"
SRC_CACHE_PID=
if [ -s cache-todo.txt ]; then python3 $S/prep-cache.py put cache-todo.txt > src-cache-upload.txt 2>&1 & SRC_CACHE_PID=$!; fi
if [ "${PREP_ONLY:-0}" = 1 ]; then   # fill the caches and stop: no training
  RC=0
  [ -n "$SRC_CACHE_PID" ] && { wait $SRC_CACHE_PID || RC=1; cat src-cache-upload.txt; }
  [ -n "$CACHE_PID" ] && { wait $CACHE_PID || RC=1; tail -n 2 cache-upload.txt; }
  [ $RC = 0 ] || { echo "prep only: a cache upload failed"; exit 1; }
  echo "prep only: caches filled after $(( ($(date +%s) - START) / 60 )) min"; exit 0
fi
if [ -n "${SOUNDCLOUD_DATA:-}" ]; then   # "<dataset repo>:<folder>", uploaded by the workflow from its SoundCloud artifacts
  python3 -c "import sys; from huggingface_hub import snapshot_download as d; r, f = sys.argv[1].split(':'); d(r, repo_type='dataset', allow_patterns=[f + '/*'], local_dir='scdl')" "$SOUNDCLOUD_DATA"
  mv "scdl/${SOUNDCLOUD_DATA#*:}" scprep && EXTRA+=(--soundcloud scprep)
fi
if [ "${ALL_TAGS:-0}" = 1 ]; then
  EXTRA+=(--fsd50k fsdprep --nsynth nsprep --freesound fsprep)
  XS=$(ls xprep/*-mel.npy | xargs -n1 basename | sed 's/-mel\.npy$//'); for x in $XS; do EXTRA+=(--extra $x=xprep); done
fi
if [ -n "${INIT_FROM:-}" ]; then   # "<repo>[@<revision>[/<folder>]]"
  python3 -c "import sys; from huggingface_hub import hf_hub_download as d; r, _, rest = sys.argv[1].partition('@'); rev, _, f = rest.partition('/'); [d(r, (f + '/' if f else '') + n, revision=rev or None, local_dir='init') for n in ('model.pt', 'log.json')]" "$INIT_FROM"
  EXTRA+=(--init "$(dirname $(find init -name model.pt | head -1))/model.pt")
fi
# Training gets what is left of the job's time limit (JOB_HOURS) after data prep, keeping 45 min for calibration, export,
# evaluation and upload, and never more than TRAIN_HOURS.
HOURS=$(python3 -c "import sys; t, j, e = map(float, sys.argv[1:]); left = j - e / 3600 - 0.75; print(round(max(0.5, min(t, left) if t else left), 2))" "${TRAIN_HOURS:-0}" "${JOB_HOURS:-7}" "$(( $(date +%s) - START ))")
echo "training budget ${HOURS} h"
if [ -n "${SOFT_LABELS:-}" ]; then EXTRA+=(--soft /tmp/soft-labels.json); fi
if [ -n "${ABSENT_FIX:-}" ]; then EXTRA+=(--absent-fix /tmp/absent-fix.json); fi
if [ "${ROUND12:-0}" = 1 ]; then EXTRA+=(--merge $S/round12/round12.json --rare-tags "$RARE_TAGS"); fi
python3 $S/train.py run --openmic prep --jamendo prepj "${EXTRA[@]}" --model "$MODEL" --epochs "$EPOCHS" --lr "$LR" --batch "$BATCH" --weak "$WEAK" --rare-repeat "${RARE_REPEAT:-1}" --repeat "${SOURCE_REPEAT:-}" --threads 8 --hours "$HOURS"
# Which data trained this model, so it can be rebuilt without any one source (chris-drive rows keep source=chris-drive).
python3 - "${EXTRA[@]}" <<'EOF'
import json, os, sys
a = sys.argv[1:]; srcs = {}
for k, v in zip(a, a[1:]):
    if k == '--extra': n, d = v.split('=', 1); srcs[n] = d
    elif k in ('--fsd50k', '--nsynth', '--freesound', '--soundcloud'): srcs[k[2:]] = v
man = {'repoSha': os.environ.get('REPO_SHA'), 'initFrom': os.environ.get('INIT_FROM'), 'sources': {}}
for n, d in sorted(srcs.items()):
    js = os.path.join(d, f'{n}.json')
    if not os.path.exists(js): continue
    j = json.load(open(js)); items = j['items']
    man['sources'][n] = {'description': j.get('source'), 'windows': len(items), 'validation': sum(bool(i.get('val')) for i in items)}
    if n in ('chrisdrive', 'chrisfx', 'iowa', 'vcsl', 'fsnew'): man['sources'][n]['ids'] = sorted({i['id'].split('#')[0].split('@')[0] for i in items})
if os.path.exists('vcslprep/eval-vcsl.json'):
    e = json.load(open('vcslprep/eval-vcsl.json')); man.setdefault('heldOutTest', {})['eval-vcsl'] = {'heldFolders': e['heldFolders'], 'clips': len(e['items']), 'note': 'never trained, tuned or calibrated on'}
if os.path.exists('saoprep/eval-sao.json'):
    e = json.load(open('saoprep/eval-sao.json')); man.setdefault('heldOutTest', {})['eval-sao'] = {'groups': sorted({i['artist'] for i in e['items']}), 'clips': len(e['items']), 'note': 'generated clips; never trained, tuned or calibrated on'}
if os.path.exists('fnprep/eval-fsnew.json'):
    e = json.load(open('fnprep/eval-fsnew.json')); man.setdefault('heldOutTest', {})['eval-fsnew'] = {'ids': sorted(i['id'] for i in e['items']), 'uploaders': len({i['artist'] for i in e['items']}), 'note': 'Freesound heldout rows; never trained, tuned or calibrated on'}
if os.path.exists('r9prep/eval-run9.json'):
    from collections import Counter
    e = json.load(open('r9prep/eval-run9.json')); pos = Counter(c[4:] for i in e['items'] for c, v in i['labels'].items() if v == 'present')
    man.setdefault('heldOutTest', {})['eval-run9'] = {'ids': sorted(i['id'] for i in e['items']), 'groups': sorted({i['artist'] for i in e['items']}),
        'positives': dict(sorted(pos.items())), 'clips': len(e['items']), 'reviewed': False,
        'note': 'run 9 held-out rows split by uploader / performer / pack and renders of them; never trained, tuned or calibrated on; '
                'nobody has listened to these clips; open-vocab round-19 test ids are NOT de-duplicated (not available)'}
    for n in ('fs9', 'ls9'):
        if n in man['sources']: man['sources'][n]['reviewed'] = False
    man['run9Ids'] = json.load(open('r9prep/run9-ids.json'))
if os.path.exists('cdprep/chrisdrive-files.json'): man['chrisDrive'] = json.load(open('cdprep/chrisdrive-files.json'))
json.dump(man, open('run/data-manifest.json', 'w'), indent=1)
print('data manifest: ' + ', '.join(f"{n} {s['windows']}" for n, s in man['sources'].items()))
EOF
# Upload the weights now, so a job that runs out of time while scoring still leaves them in the repo.
python3 - <<EOF
import os
from huggingface_hub import HfApi
api = HfApi(); repo = os.environ['HF_REPO']; api.create_repo(repo, private=True, exist_ok=True)
api.upload_folder(repo_id=repo, folder_path='run', path_in_repo=os.environ.get('OUT_DIR') or None, allow_patterns=['model.pt', 'log.json', 'data-manifest.json'],
                  delete_patterns=['onnx/*', 'thresholds.json', 'calibrate.txt', 'eval.*', 'coverage.*', 'data-manifest.json'],   # an earlier run's scores never sit beside new weights
                  commit_message='DGE tagger run at ${REPO_SHA:0:7}: ${MODEL} weights, before scoring')
EOF
CAL=(openmic=prep jamendo=prepj); EVAL=(prep/eval-round1 prep/eval-round2 holdout/holdout-r3)
[ -d scprep ] && CAL+=(soundcloud=scprep)
[ -n "$RS_PID" ] && CAL+=(rawstems=rsprep)
[ -f rsprep/rsfx.json ] && CAL+=(rsfx=rsprep)
[ -n "$IOWA_PID" ] && CAL+=(iowa=iowaprep)
[ -n "$CD_PID" ] && CAL+=(chrisdrive=cdprep chrisfx=cdprep)
[ -n "$VCSL_PID" ] && CAL+=(vcsl=vcslprep) && EVAL+=(vcslprep/eval-vcsl)
[ -n "$SM_PID" ] && CAL+=(slakhmore=smprep)
[ -n "$SAO_PID" ] && CAL+=(sao=saoprep) && EVAL+=(saoprep/eval-sao)
[ -n "$FN_PID" ] && CAL+=(fsnew=fnprep) && EVAL+=(fnprep/eval-fsnew)
[ -n "$RN_PID" ] && CAL+=(fs9=r9prep ls9=r9prep) && EVAL+=(r9prep/eval-run9)
[ -n "$R10_PID" ] && CAL+=(round10=r10prep)
[ -n "${ET_PID:-}" ] && CAL+=(etfs9=etprep etls9=etprep)
if [ "${ALL_TAGS:-0}" = 1 ]; then CAL+=(fsd50k=fsdprep nsynth=nsprep freesound=fsprep); for x in $XS; do CAL+=($x=xprep); done; EVAL+=(fsdprep/eval-fsd50k nsprep/eval-nsynth-test nsprep/eval-nsynth-test-fx fsprep/eval-freesound); fi
python3 $S/calibrate.py run "${CAL[@]}" | tee run/calibrate.txt
python3 $S/coverage.py run "${CAL[@]}" 
python3 $S/export.py run/model.pt run/onnx --model "$MODEL"
python3 $S/evaluate.py run/onnx/model.onnx run/thresholds.json run/eval.json "${EVAL[@]}" | tee run/eval.txt
python3 - <<EOF
import os
from huggingface_hub import HfApi
api = HfApi(); repo = os.environ['HF_REPO']
api.create_repo(repo, private=True, exist_ok=True)
api.upload_folder(repo_id=repo, folder_path='run', path_in_repo=os.environ.get('OUT_DIR') or None, allow_patterns=['onnx/*', 'thresholds.json', 'log.json', 'calibrate.txt', 'eval.*', 'coverage.*', 'model.pt', 'data-manifest.json'],
                  commit_message='DGE tagger run at ${REPO_SHA:0:7}: ${MODEL}, ${EPOCHS} epochs')
print('uploaded to https://huggingface.co/' + repo)
EOF
if [ -n "$CACHE_PID" ]; then wait $CACHE_PID || echo "prep cache upload failed (training results are unaffected)"; tail -n 2 cache-upload.txt; fi
if [ -n "$SRC_CACHE_PID" ]; then wait $SRC_CACHE_PID || true; cat src-cache-upload.txt; fi
