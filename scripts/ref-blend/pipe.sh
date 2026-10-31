#!/bin/bash
# usage: pipe.sh <variant>  (learned-<variant>.json)
v=$1; D=/mnt/project-files/reports/clap-heads-2026-10-29/private; cd /home/user/document-graph-explorer
for s in free-tag-set-test fsd50k-eval heard-reserved public3; do npx vite-node /mnt/project-files/reports/scoreboard/scripts/app_tags_v2.ts $D/emb/$s $D/durations.json /var/tmp/rb/dec/$v-$s.jsonl /var/tmp/rb/learned-$v.json >/dev/null 2>&1; done
python3 -I /mnt/project-files/reports/scoreboard/scripts/real_app_filter.py $D/durations.json /var/tmp/rb/dec/$v-real.jsonl /var/tmp/rb/dec/$v-{free-tag-set-test,fsd50k-eval,heard-reserved,public3}.jsonl
python3 -I /mnt/project-files/reports/scoreboard/scripts/app_clap_score.py --board /var/tmp/rb/board.json --decisions /var/tmp/rb/dec/$v-real.jsonl --out /var/tmp/rb/dec/app-clap-$v.json | tail -1
