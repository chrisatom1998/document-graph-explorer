"""Builds a blind listening check of the clips the distorted head setups disagree with their folder labels on.

Every clip some setup flagged as distorted although its folder says it is not goes into a separate review
folder, with no model hints, in a fixed shuffled order. A sidecar file keeps what rescoring needs.
Serve it with the model update switched off so confirming a clip never rebuilds the shipped heads:
  DJ_REVIEW_DATA=artifacts/music-evaluation/distorted-check DJ_REVIEW_PORT=8767 DJ_REVIEW_NO_APPLY=1 python3 scripts/dj-review-server.py
Usage: build-character-check.py <character-hardneg.json> [label]"""
import json, sys, os, hashlib, random, subprocess
from pathlib import Path

REPORT = sys.argv[1]; LABEL = sys.argv[2] if len(sys.argv) > 2 else 'distorted'
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / f'artifacts/music-evaluation/{LABEL}-check'
INDEX = '/Users/chrisjohnson/Documents/Media/dj-training-sounds/index.json'
GROUPS = ('source', 'production', 'character')

row = next(r for r in json.load(open(REPORT))['results'] if r['label'] == LABEL)
flagged = {}
for setup, s in row['setups'].items():
    for i in s.get('falseAlarmIds', []): flagged.setdefault(i, []).append(setup)
index = {f"fs:{os.path.basename(os.path.dirname(it['file']))}:{it['id']}": it for it in json.load(open(INDEX))['items']}
ids = sorted(flagged); random.Random(f'{LABEL}-check').shuffle(ids)

(OUT / 'audio').mkdir(parents=True, exist_ok=True)
items, sidecar = [], {}
for n, i in enumerate(ids, 1):
    it = index[i]; digest = hashlib.sha256(i.encode()).hexdigest()[:16]
    preview = OUT / 'audio' / f'{digest}.wav'
    if not preview.exists():
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', it['file'], '-t', '10', '-ac', '1', '-ar', '22050', str(preview)], check=True)
    seconds = min(10.0, float(it.get('duration') or 10))
    # Titles carry no file name: names like "distortion drone" would give the answer away.
    items.append({'id': digest, 'title': f'Check clip {n}', 'preview': f'audio/{digest}.wav', 'seconds': round(seconds, 1),
                  'folder': f'{LABEL} check', 'proposedLabels': {g: [] for g in GROUPS}, 'labelProvenance': 'blind listening check',
                  'hintReasons': [], 'automaticTags': [], 'reviewed': False})
    sidecar[digest] = {'clipId': i, 'freesoundId': it['id'], 'folderLabel': it['label'], 'username': it['username'],
                       'name': it['name'], 'flaggedBy': flagged[i]}
scope = (f'Judge {LABEL} only. If you hear it, select the character tag "{LABEL}" and confirm; '
         'otherwise confirm with nothing selected. Other labels are optional.')
(OUT / 'manifest.json').write_text(json.dumps({'version': 1, 'scope': scope, 'items': items}, indent=2) + '\n')
(OUT / 'check-sidecar.json').write_text(json.dumps({'label': LABEL, 'report': REPORT, 'clips': sidecar}, indent=2) + '\n')
print(f'{len(items)} clips -> {OUT}')
