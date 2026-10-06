# Duplicates and remixes test set

Scores the versions links (`src/audio/versionLinks.ts`) the way the track card shows them. Results and method are in `docs/audio-graph-relationships.md`.

1. `python3 scripts/versions/fetch-ccmixter-remixes.py OUT/ccmixter` downloads remixes of ccMixter a cappellas (Creative Commons; the manifest keeps each license and page).
2. `node scripts/versions/build-versions-test-set.mjs OUT/ccmixter LOOP_DIR OUT/set` makes 8 ffmpeg/rubberband copies of the first 2 remixes per song and of every loop, under neutral names, and writes `manifest.json` there with each file's recording and song.
3. `npx vite-node scripts/versions/features.ts OUT/set/manifest.json OUT/features.jsonl` computes each file's version print and CLAP fingerprint (optional `SHARD SHARDS` args split the work; concatenate the outputs).
4. `npx vite-node scripts/versions/evaluate.ts OUT/set/manifest.json OUT/features.jsonl OUT/result.json` prints precision and recall for duplicates and other versions on halves A (tuning) and B (held out), by transform, with names hidden and without prints. `--pairs FILE` dumps raw comparison numbers for threshold plots.

Thresholds (`VERSION_RULES`) were chosen on half A only. Use half B to judge, never to tune.
