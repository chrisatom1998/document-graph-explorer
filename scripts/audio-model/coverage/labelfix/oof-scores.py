"""Coverage idea #2, step 1: out-of-fold round 11 teacher scores for every training clip that has teacher features.

python3 -I oof-scores.py <round11 features dir> <run9 manifest-audited.csv> <out.npz> [--epochs 40] [--folds 5]
  <round11 features dir>: a local copy of cmjatom/dge-audio-training round11/ (run9/, commercial/, emptytags/, mirror/;
  each with *.npz from teacher-features.py and manifests/). Only train-side rows are read:
    run9       manifest-audited.csv rows with keep=1 and split=train (the audit's merged tags; what prepare-run9.py --audit trains)
    commercial round 10's train-only commercial list (manifests/commercial.csv; tags and outright absences)
    emptytags  empty-tags/v1 manifests, keep=1 and split=train
  No held-out row is read or scored here (the run 9 held-out rows in the staged tars are skipped by split).

The teacher is round11/fit-teacher.py's recipe unchanged (same features, Head, loss, folds by group hash 'dge-r11|<group>',
min 15 positives per tag), refit here on CPU because the round 11 fold models' out-of-fold scores were not saved. Each clip's
score comes from the fold model that never saw its group (uploader / pack / recording), so a clip's own weak absence never
teaches the score that judges it. The five fold models are also saved (teacher.pt, for the mirror pass) with the frozen
out-of-fold thresholds (argmax min(P, R)) that fit-teacher.py would pick.

Writes <out.npz>: item (train.py item id), kind (run9 / round10 / emptytags), group, source, scores (clips x tags, float16),
vocab, own (|-joined own tags), and next to it teacher.pt + thresholds.json + val.json.
"""
import argparse, csv, glob, hashlib, importlib.util, json, os, sys

import numpy as np
import torch
import torch.nn as nn

HERE = os.path.dirname(os.path.abspath(__file__))
AM = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location('ft', os.path.join(AM, 'round11', 'fit-teacher.py'))
ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)


def split(s, sep='|'):
    return [t for t in (s or '').replace(';', sep).split(sep) if t]


def rows(feat, audit):
    """feature id -> (train.py item id, kind, group, source, own tags, outright-absent tags)."""
    man = {}
    for r in csv.DictReader(open(audit, newline='', encoding='utf-8')):
        if r.get('keep') == '1' and r['split'] == 'train':
            man[f"{os.path.basename(r['part'])}/{r['file']}"] = (r['id'], 'run9', r['group'], r['source'], split(r['tags']), [])
    for r in csv.DictReader(open(os.path.join(feat, 'commercial', 'manifests', 'commercial.csv'), newline='', encoding='utf-8')):
        if r.get('split', 'train') == 'train':
            src = r['group'].split(':')[0]
            man[f"commercial/{r['file']}"] = (f"round10:{src}:{r['id']}", 'round10', r['group'], src, split(r['tags']), split(r['absent']))
    for m in glob.glob(os.path.join(feat, 'emptytags', 'manifests', '*.csv')):
        d = os.path.basename(m)[:-4].split('__')[-1]
        for r in csv.DictReader(open(m, newline='', encoding='utf-8')):
            if r.get('keep', '1') == '1' and r.get('split') == 'train':
                man[f"{d}/{r['file']}"] = (r['id'], 'emptytags', r['group'], r['source'], split(r['tags']), [])
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('feat'); ap.add_argument('audit'); ap.add_argument('out')
    ap.add_argument('--epochs', type=int, default=40); ap.add_argument('--folds', type=int, default=5); ap.add_argument('--min-pos', type=int, default=15)
    ap.add_argument('--threads', type=int, default=os.cpu_count())
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    man = rows(a.feat, a.audit)
    X, meta = [], []
    for d in ('run9', 'commercial', 'emptytags'):
        for f in sorted(glob.glob(os.path.join(a.feat, d, '*.npz'))):
            z = np.load(f)
            F = ft.feats(z, 'all')
            for i, cid in enumerate(z['id']):
                m = man.get(str(cid))
                if m is not None:
                    X.append(F[i]); meta.append(m)
    X = np.stack(X).astype(np.float32)
    tags = [m[4] for m in meta]
    cnt = {}
    for ts in tags:
        for t in ts: cnt[t] = cnt.get(t, 0) + 1
    vocab = sorted(t for t, n in cnt.items() if n >= a.min_pos)
    ix = {t: i for i, t in enumerate(vocab)}
    Y = np.zeros((len(X), len(vocab)), np.float32)
    for n, ts in enumerate(tags):
        for t in ts:
            if t in ix: Y[n, ix[t]] = 1
    groups = [m[2] for m in meta]
    fold = np.array([int(hashlib.sha256(f'dge-r11|{g}'.encode()).hexdigest()[:8], 16) % a.folds for g in groups])
    print(f'{len(X)} train clips ({sum(m[1] == "run9" for m in meta)} run9, {sum(m[1] == "round10" for m in meta)} round10, '
          f'{sum(m[1] == "emptytags" for m in meta)} emptytags), {len(vocab)} tags, {a.folds} folds by group', flush=True)
    Xt, Yt = torch.from_numpy(X), torch.from_numpy(Y)
    S = np.zeros_like(Y); states = []
    for k in range(a.folds):   # fit-teacher.py's loop, unchanged
        torch.manual_seed(k)
        tr, va = np.where(fold != k)[0], np.where(fold == k)[0]
        pos = Y[tr].sum(0)
        pw = torch.from_numpy(np.clip((len(tr) - pos) / np.maximum(pos, 1), 1, 30) ** 0.5).float()
        model = ft.Head(X.shape[1], len(vocab))
        opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-2)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=a.epochs * (len(tr) // 256 + 1))
        lossf = nn.BCEWithLogitsLoss(pos_weight=pw)
        for ep in range(a.epochs):
            model.train()
            perm = np.random.default_rng(ep + 100 * k).permutation(tr)
            tot = 0.0
            for s in range(0, len(perm), 256):
                b = perm[s:s + 256]
                loss = lossf(model(Xt[b]), Yt[b])
                opt.zero_grad(); loss.backward(); opt.step(); sched.step()
                tot += loss.item() * len(b)
        model.eval()
        with torch.no_grad():
            S[va] = torch.sigmoid(model(Xt[va])).numpy()
        states.append(model.state_dict())
        print(f'fold {k} done, loss {tot / len(tr):.4f}', flush=True)
    thr, rep = {}, {}
    for t, i in ix.items():
        r = ft.pick(S[:, i], Y[:, i] > 0)
        rep[t] = {'pos': int(Y[:, i].sum())}
        if r:
            thr[t] = r[0]; rep[t].update(oof_p=round(r[1], 3), oof_r=round(r[2], 3))
    od = os.path.dirname(os.path.abspath(a.out))
    torch.save({'states': states, 'vocab': vocab, 'dim': X.shape[1], 'kind': 'all'}, os.path.join(od, 'teacher.pt'))
    json.dump(thr, open(os.path.join(od, 'thresholds.json'), 'w'), indent=1)
    json.dump(rep, open(os.path.join(od, 'val.json'), 'w'), indent=1)
    np.savez_compressed(a.out, item=np.array([m[0] for m in meta]), kind=np.array([m[1] for m in meta]), group=np.array(groups),
                        source=np.array([m[3] for m in meta]), own=np.array(['|'.join(m[4]) for m in meta]),
                        absent=np.array(['|'.join(m[5]) for m in meta]), fold=fold.astype(np.int8),
                        scores=S.astype(np.float16), vocab=np.array(vocab))
    print(f'{len(thr)} tags with a frozen out-of-fold threshold; wrote {a.out}', flush=True)


if __name__ == '__main__':
    main()
