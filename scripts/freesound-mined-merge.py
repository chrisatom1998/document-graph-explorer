"""Merges the Freesound mining passes (candidates*.json + downloaded previews) into one training
manifest, one row per Freesound sound with the union of its labels, so no clip appears twice with
disagreeing labels. Safe to re-run while downloads continue (only finished downloads are listed).
Usage: freesound-mined-merge.py <out manifest.json> <candidates.json>@<download dir> ..."""
import json, sys, os
OUT = sys.argv[1]; clips = {}
for spec in sys.argv[2:]:
    cands, folder = spec.split('@')
    state = json.load(open(f'{folder}/state.json')) if os.path.exists(f'{folder}/state.json') else {}
    for c in json.load(open(cands))['clips']:
        key = str(c['freesoundId']); path = f'{folder}/audio/{key}.mp3'
        if state.get(key, {}).get('status') != 'ok' or not os.path.exists(path) or os.path.getsize(path) < 8000: continue
        row = clips.setdefault(key, {**c, 'labels': [], 'path': path, 'licence': state[key].get('licence'), 'author': c['username'],
                                     'url': f"https://freesound.org/people/{c['username']}/sounds/{key}/"})
        row['labels'] = sorted(set(row['labels']) | set(c['labels']))
if os.path.dirname(OUT): os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({'kind': 'freesound-mined-v1', 'clips': list(clips.values())}, open(OUT, 'w'), indent=1)
from collections import Counter
lic = Counter((c['licence'] or 'unknown').split('/')[4] if c['licence'] else 'unknown' for c in clips.values())
print(len(clips), 'clips; licences', dict(lic))
