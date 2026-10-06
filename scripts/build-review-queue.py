"""Builds a listening queue for labels that no method could learn, for the existing review tool.
Per label: up to N clips whose Freesound tags name it (likely yes) plus N untagged clips the raw CLAP prompt
ranks highest (likely confusions). Both kinds are what a detector most needs a human answer on.
Writes a review-tool data folder (manifest.json + audio/<id>.wav, first 10 s, 48 kHz mono).
Open with:  DJ_REVIEW_DATA=<out> DJ_REVIEW_NO_APPLY=1 python3 scripts/dj-review-server.py
Usage: build-review-queue.py <out dir> <fsm manifest> <fingerprint dir> label,label,...   env: PER (15)"""
import json, sys, os, glob, hashlib, subprocess
import numpy as np
OUT, MAN, EMB, LABELS = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(',')
PER = int(os.environ.get('PER', 15)); os.makedirs(f'{OUT}/audio', exist_ok=True)
meta = {c['id']: c for c in json.load(open(MAN))['clips']}
emb = {}
for f in glob.glob(f'{EMB}/emb-*.jsonl'):
    for line in open(f):
        r = json.loads(line)
        if r['id'] in meta: emb.setdefault(r['id'], r['embedding'])
ids = list(emb); X = np.asarray([emb[i] for i in ids], dtype=np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True)
prompts = [p for p in json.load(open('public/sound-model/prompts.json')) if p['label'] in LABELS]
items, used = [], set()
for label in LABELS:
    t = np.mean([np.asarray(p['vector']) / np.linalg.norm(p['vector']) for p in prompts if p['label'] == label], axis=0); s = X @ (t / np.linalg.norm(t)).astype(np.float32)
    tagged = [i for i in np.argsort(-s) if label in meta[ids[i]]['labels']][:PER]
    untagged = [i for i in np.argsort(-s) if label not in meta[ids[i]]['labels']][:PER]
    for i, kind in [(i, 'tagged') for i in tagged] + [(i, 'confusion') for i in untagged]:
        cid = ids[i]
        if cid in used: continue
        used.add(cid); c = meta[cid]; hid = hashlib.sha256(cid.encode()).hexdigest()[:16]
        wav = f'{OUT}/audio/{hid}.wav'
        if not os.path.exists(wav):
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', c['path'], '-t', '10', '-ac', '1', '-ar', '48000', wav], check=False)
        if not os.path.exists(wav): continue
        items.append({'id': hid, 'title': c.get('title') or cid, 'originalPath': c['path'], 'preview': f'audio/{hid}.wav', 'seconds': 10,
                      'folder': f'{label} ({kind})', 'proposedLabels': {'source': [], 'production': [], 'character': []},
                      'labelProvenance': f"Freesound tags only ({', '.join(c['labels'][:6])}); not listened to",
                      'hintReasons': [f'asks: is this "{label}"?', 'tagged by uploader' if kind == 'tagged' else 'CLAP thinks it sounds like it, not tagged'],
                      'automaticTags': [], 'embedding': [round(float(v), 6) for v in X[i]], 'reviewed': False,
                      'freesound': {'url': c.get('url'), 'licence': c.get('licence'), 'author': c.get('author')}})
json.dump({'version': 1, 'created': 'build-review-queue.py', 'scope': 'First ten seconds per clip.', 'items': items}, open(f'{OUT}/manifest.json', 'w'), indent=1)
print(len(items), 'clips for', len(LABELS), 'labels ->', OUT)
