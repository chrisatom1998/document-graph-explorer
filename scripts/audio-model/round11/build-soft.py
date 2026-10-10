"""Round 11: teacher soft labels for the tagger (train.py --soft). LOCAL: reads teacher-features npz + manifests.

python3 build-soft.py <teacher dir> <features dir> <out.json> <tag,tag,...>
Each clip gets the out-of-fold teacher (the fold model that never saw its group), shifted so the teacher threshold sits
at 0.5. Ids match prepare-run9.py (manifest id) and prepare-round10.py (round10:<source>:<path>)."""
import sys, glob, csv, json, hashlib, os, numpy as np, torch
HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location('ft', os.path.join(HERE, 'fit-teacher.py')); ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)
tdir, feat, out = sys.argv[1:4]; TAGS = sys.argv[4].split(',')
ck = torch.load(f'{tdir}/teacher.pt'); vocab = ck['vocab']; kind = ck.get('kind', 'all')
ms = []
for st in ck['states']:
    m = ft.Head(ck['dim'], len(vocab)); m.load_state_dict(st); m.eval(); ms.append(m)
cols = [vocab.index(t) for t in TAGS]
thr = json.load(open(f'{tdir}/thresholds.json'))
lt = np.array([np.log(thr[t] / (1 - thr[t])) for t in TAGS])
# shift each tag so the teacher's frozen threshold sits at 0.5 (soft target 'present' exactly where the teacher says so)
shift = lambda p: 1 / (1 + np.exp(-(np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6))) - lt)))
man = {}
for mf in glob.glob(f'{feat}/manifests/*.csv'):
    d = os.path.basename(mf)[:-4].split('__')[-1]
    for r in csv.DictReader(open(mf, newline='', encoding='utf-8')):
        man[f"{d}/{r['file']}"] = (d, r)
soft = {}
for f in sorted(glob.glob(f'{feat}/*.npz')):
    z = np.load(f); F = ft.feats(z, kind)
    with torch.no_grad():
        P = [torch.sigmoid(m(torch.from_numpy(F))).numpy()[:, cols] for m in ms]
    for i, cid in enumerate(z['id']):
        x = man.get(str(cid))
        if not x: continue
        d, r = x
        k = int(hashlib.sha256(f"dge-r11|{r['group']}".encode()).hexdigest()[:8], 16) % len(ms)   # out-of-fold model
        p = shift(P[k][i])
        iid = f"round10:{r['group'].split(':')[0]}:{r['id']}" if d == 'commercial' else r['id']
        soft[iid] = {t: round(float(v), 3) for t, v in zip(TAGS, p)}
json.dump({'tags': TAGS, 'teacher': os.path.basename(tdir), 'items': soft}, open(out, 'w'))
print(len(soft), 'items')
