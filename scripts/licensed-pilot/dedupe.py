"""Decoded-audio de-duplication between the pilot's training rows and the locked holdout, and within training.

Usage: python3 -I scripts/licensed-pilot/dedupe.py <holdout.json> <free-tag-set dir> <emb.jsonl,...> <out-dir> <manifest.csv>...
Writes <out-dir>/<manifest name> (rows kept) and <out-dir>/dedupe.json (every dropped row and why).

Three tests, each on decoded audio rather than file bytes, so mirrors, re-encodes and renamed copies are caught:
1. identical 16 kHz mono PCM (sha256) to a holdout file or to an earlier training row;
2. CLAP embedding cosine >= 0.98 to any holdout file (catches crops, gain changes and transcodes of the same sound);
3. CLAP cosine >= 0.995 to a training row of a different fold group (the copy would leak across folds).
A training row hit by 1 or 2 is dropped; a row hit by 3 merges its fold group with every group it near-copies. A training row with no
embedding is dropped too (it cannot get tests 2-3, nor be trained on). Holdout files too short to embed (under 0.1 s)
still get test 1 and are listed in dedupe.json. Any other missing holdout embedding aborts the run.
"""
import csv, hashlib, json, os, subprocess, sys
import numpy as np

HOLD, FTS, EMB, OUT, *MANIFESTS = sys.argv[1:]
if hashlib.sha256(open(HOLD, 'rb').read()).hexdigest() != open(os.path.join(os.path.dirname(HOLD), 'holdout.lock')).read().split()[0]:
    sys.exit(f'{HOLD} does not match holdout.lock')
emb = {}
for f in EMB.split(','):
    for line in open(f):
        r = json.loads(line); emb.setdefault(r['id'], r['embedding'])
unit = lambda v: np.asarray(v) / np.linalg.norm(v)
hold = json.load(open(HOLD))['items']
missing_holdout = []
for i in hold:
    if i['id'] in emb: continue
    seconds = i.get('seconds')
    if (not isinstance(seconds, (int, float)) or isinstance(seconds, bool)
            or not np.isfinite(seconds) or not 0 < seconds < 0.1):
        missing_holdout.append(i['id'])
if missing_holdout:
    sys.exit('missing CLAP embeddings for holdout items without verified 0 < seconds < 0.1 duration: '
             + ', '.join(missing_holdout))
os.makedirs(OUT, exist_ok=True)
hpcm = {}
for i in hold:
    dec = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', os.path.join(FTS, i['path']), '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True)
    # A holdout file that cannot be decoded cannot get the exact-PCM test, so the run stops rather than skip it.
    if dec.returncode != 0 or not dec.stdout: sys.exit(f"holdout {i['id']} failed to decode: exact-PCM check impossible")
    hpcm[hashlib.sha256(dec.stdout).hexdigest()] = i['id']
H = np.stack([unit(emb[i['id']]) for i in hold if i['id'] in emb]); hids = [i['id'] for i in hold if i['id'] in emb]
dropped, regrouped, kept_pcm, kept, outputs = [], [], {}, [], []
parent = {}  # union-find over fold groups: every group a near-copy touches becomes one group
def root(g):
    while parent.get(g, g) != g: g = parent[g]
    return g
for m in MANIFESTS:
    reader = csv.DictReader(open(m)); rows = list(reader); fields = reader.fieldnames or []; out = []
    for r in rows:
        why = None
        if r['pcm16k_sha256'] in hpcm: why = f"decoded audio identical to holdout {hpcm[r['pcm16k_sha256']]}"
        elif r['pcm16k_sha256'] in kept_pcm: why = f"decoded audio identical to training row {kept_pcm[r['pcm16k_sha256']]}"
        elif r['id'] not in emb: why = 'no CLAP embedding (too short or silent): cosine checks impossible, and it cannot be trained on'
        else:
            v = unit(emb[r['id']]); sims = H @ v; j = int(sims.argmax())
            if sims[j] >= 0.98: why = f'CLAP cosine {sims[j]:.3f} to holdout {hids[j]}'
            else:
                for kid, kv, kg in kept:
                    a, b = root(r['fold_group']), root(kg)
                    if a != b and float(kv @ v) >= 0.995:
                        regrouped.append({'id': r['id'], 'near': kid, 'merged': [a, b], 'cosine': round(float(kv @ v), 4)}); parent[a] = b
        if why: dropped.append({'id': r['id'], 'manifest': os.path.basename(m), 'reason': why}); continue
        kept_pcm[r['pcm16k_sha256']] = r['id']
        kept.append((r['id'], unit(emb[r['id']]), r['fold_group']))
        out.append(r)
    outputs.append((m, fields, rows, out))
# Groups are written only after every manifest is seen, so a merge reaches rows kept earlier too.
for m, fields, rows, out in outputs:
    for r in out: r['fold_group'] = root(r['fold_group'])
    with open(os.path.join(OUT, os.path.basename(m)), 'w', newline='') as f:
        w = csv.DictWriter(f, fields); w.writeheader(); w.writerows(out)
    print(f'{os.path.basename(m)}: kept {len(out)} of {len(rows)}')
json.dump({'dropped': dropped, 'regrouped': regrouped, 'holdout_files_compared': len(hold), 'holdout_embedded': len(hids),
           'holdout_not_embedded': [i['id'] for i in hold if i['id'] not in emb]},
          open(os.path.join(OUT, 'dedupe.json'), 'w'), indent=1)
print(f'dropped {len(dropped)}, regrouped {len(regrouped)}')
