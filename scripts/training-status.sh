#!/usr/bin/env bash
# Live progress for the DJ-sound training jobs, with finish times measured from real speed.
SP=/private/tmp/claude-501/-Users-chrisjohnson-Projects-document-graph-explorer/fae466bf-bfd7-43ce-bf0a-9b09b243fef6/scratchpad
count() { cat "$@" 2>/dev/null | wc -l | tr -d ' '; }
a1=$(count $SP/fx/emb-*.jsonl); a2=$(count $SP/vault-passt/emb-*.jsonl); sleep 15
b1=$(count $SP/fx/emb-*.jsonl); b2=$(count $SP/vault-passt/emb-*.jsonl)
eta() { # done total rate_per_15s extra_minutes
  local done=$1 total=$2 step=$3 extra=$4
  if [ "$done" -ge "$total" ]; then echo "done"; return; fi
  if [ "$step" -le 0 ]; then echo "stalled or paused"; return; fi
  local secs=$(( (total - done) * 15 / step + extra * 60 ))
  date -v+${secs}S "+%-I:%M %p  (about $((secs/60)) min)"
}
echo "Now: $(date '+%-I:%M %p')"
echo
printf "%-30s %-16s %s\n" "Job" "Progress" "Finishes"
printf "%-30s %-16s %s\n" "Effects fingerprints" "$b1 / 56454" "$(eta $b1 56454 $((b1-a1)) 2)"
printf "%-30s %-16s %s\n" "PaSST vs CLAP fingerprints" "$b2 / 9105" "$(eta $b2 9105 $((b2-a2)) 2)"
printf "%-30s %-16s %s\n" "Downloads still running" "$(pgrep -f 'fetch-zenodo-parallel|fetch-hf-dataset' | wc -l | tr -d ' ') jobs" ""
