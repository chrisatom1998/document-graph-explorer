"""List every later 10 s window of the holdout's longer files, for score_offline.py's all-window screen.

Usage: python3 -I scripts/licensed-pilot/window_clips.py <holdout.json> <free-tag-set dir> <out windows-clips.json>
Then: THREADS=4 node scripts/embed-clap.mjs <out windows-clips.json> <windows.jsonl>
Starts follow the app's Full-mode plan (src/audio/instrumentEvidence.ts instrumentWindowStarts): every 5 s while a full
10 s window fits, plus the last full window. The window at 0 s is the first-window embedding already in holdout.jsonl.
"""
import json, os, sys

HOLD, FTS, OUT = sys.argv[1:4]
clips = []
for i in json.load(open(HOLD))['items']:
    if i['short'] or i['seconds'] <= 10: continue
    last, starts, s = i['seconds'] - 10, [], 0.0
    while s <= last + 1e-9: starts.append(round(s, 3)); s += 5
    if last > starts[-1] + 1e-6: starts.append(round(last, 3))
    clips += [{'id': f"{i['id']}@{s}", 'path': os.path.join(os.path.abspath(FTS), i['path']), 'start': s} for s in starts[1:]]
json.dump({'clips': clips}, open(OUT, 'w'))
print(f'{len(clips)} later windows')
