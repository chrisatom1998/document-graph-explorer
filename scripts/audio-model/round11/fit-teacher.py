"""Round 11 teacher: one multi-label MLP over frozen CED-base + CLAP features of the training audio.

python3 fit-teacher.py <features dir (npz + manifests/)> <out dir> [--keep keep.csv]
Labels come from the staged manifests (tags column, '|'-separated). Untagged clips are negatives for a tag (weak view),
so validation precision is a lower bound. Five models are fit, each without one fold of groups (uploaders / source
groups); the teacher averages them. Each tag's threshold is frozen on the out-of-fold scores (argmax min(P, R), ties to higher F1, >= 10 positives and negatives).
No held-out (judge) clip is read here. Writes teacher.pt, thresholds.json and val.json.
"""
import argparse, csv, glob, hashlib, json, os, sys

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import charts  # noqa: E402  live training charts (aggregates only)


def feats(z, kind="all"):
    """kind: all = CED-base embedding + CLAP + CED AudioSet logits; ced = CED-base only; or blocks joined by '+' from
    ced, das (Dasheng-0.6B) and mert (MERT-v1-330M), e.g. ced+das (big-teacher/features.py)."""
    p = np.clip(z["ced_probs"].astype(np.float32), 1e-4, 1 - 1e-4) if "ced_probs" in z else None
    if kind in ("all", "ced"):
        parts = [z["ced_emb"].astype(np.float32), np.log(p / (1 - p)) / 4]
        if kind == "all":
            c = z["clap"].astype(np.float32)
            parts.append(c / (np.linalg.norm(c, axis=1, keepdims=True) + 1e-8) * 10)
        return np.concatenate(parts, 1)
    parts = []
    for b in kind.split("+"):
        if b == "ced":
            parts += [z["ced_emb"].astype(np.float32), np.log(p / (1 - p)) / 4]
        else:
            parts.append(z[b].astype(np.float32))
    return np.concatenate(parts, 1)


def drop_ids(path):
    """Training ids named in the private test-leak exclude list (never uploaded): Freesound ids as freesound:<n>."""
    d = json.load(open(path))
    out = set()
    for sec in ("round13_must_drop", "round13_should_drop_same_uploader"):
        for v in d.get(sec, {}).values():
            for x in v:
                x = str(x)
                if x.isdigit():
                    x = "freesound:" + x
                elif x.startswith("fs:"):
                    x = "freesound:" + x[3:]
                out.add(x)
    return out


class Head(nn.Module):
    def __init__(self, d, k, h=768):
        super().__init__()
        self.norm = nn.LayerNorm(d)
        self.net = nn.Sequential(nn.Dropout(0.2), nn.Linear(d, h), nn.GELU(), nn.Dropout(0.3), nn.Linear(h, k))

    def forward(self, x):
        return self.net(self.norm(x))


def load(path):
    """The fold-averaged teacher: returns f(features) -> probabilities."""
    ck = torch.load(path)
    ms = []
    for st in ck["states"]:
        m = Head(ck["dim"], len(ck["vocab"])); m.load_state_dict(st); m.eval(); ms.append(m)

    mu, sd = (None, None) if ck.get("mu") is None else (ck["mu"].numpy(), ck["sd"].numpy())

    def f(x):
        if mu is not None:
            x = ((x - mu) / sd).astype(np.float32)
        with torch.no_grad():
            x = torch.from_numpy(x)
            return np.mean([torch.sigmoid(m(x)).numpy() for m in ms], 0)
    return f, ck["vocab"], ck.get("kind", "all")


def pick(s, y, min_n=10):
    if y.sum() < min_n or (~y).sum() < min_n:
        return None
    o = np.argsort(-s)
    tp = np.cumsum(y[o]); fp = np.cumsum(~y[o])
    p = tp / (tp + fp); r = tp / y.sum()
    f = 2 * p * r / np.maximum(p + r, 1e-9)
    key = np.minimum(p, r) + 1e-6 * f
    i = int(np.argmax(key))
    return float(s[o][i]), float(p[i]), float(r[i])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("feat"); ap.add_argument("out"); ap.add_argument("--keep")
    ap.add_argument("--epochs", type=int, default=40); ap.add_argument("--min-pos", type=int, default=15); ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--feats", default="all", help="all, ced, or '+'-joined blocks of ced, das, mert")
    ap.add_argument("--extra", action="append", default=[], help="another features dir for the same clips (joined by id)")
    ap.add_argument("--exclude", help="private test-leak exclude-lists.json: drop the training ids it names")
    ap.add_argument("--zscore", action="store_true", help="standardise each feature on the training clips (stored in teacher.pt)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    man = {}
    for m in glob.glob(os.path.join(a.feat, "manifests", "*.csv")):
        d = os.path.basename(m)[:-4].split("__")[-1]
        for r in csv.DictReader(open(m, newline="", encoding="utf-8")):
            if r.get("split", "train") != "train":
                continue
            man[f"{d}/{r['file']}"] = r
    keep = None
    if a.keep:
        keep = {r["id"] for r in csv.DictReader(open(a.keep)) if r.get("keep", "1") in ("1", "true", "keep")}
    drop = drop_ids(a.exclude) if a.exclude else set()
    X, tags, groups = [], [], []
    ndrop = 0
    for f in sorted(glob.glob(os.path.join(a.feat, "*.npz"))):
        z = dict(np.load(f))
        for e in a.extra:  # same file name in the other dir; keep the clips both describe
            ep = os.path.join(e, os.path.basename(f))
            if not os.path.exists(ep):
                z = None; break
            ez = np.load(ep); ix = {str(c): i for i, c in enumerate(ez["id"])}
            sel = [i for i, c in enumerate(z["id"]) if str(c) in ix]
            z = {k: v[sel] for k, v in z.items()}
            for k in ez.files:
                if k not in z:
                    z[k] = ez[k][[ix[str(c)] for c in z["id"]]]
        if z is None or not len(z["id"]):
            continue
        F = feats(z, a.feats)
        for i, cid in enumerate(z["id"]):
            r = man.get(str(cid))
            if r is None or (keep is not None and r["id"] not in keep):
                continue
            if r["id"] in drop:
                ndrop += 1
                continue
            X.append(F[i]); tags.append([t for t in r["tags"].split("|") if t]); groups.append(r["group"])
    X = np.stack(X)
    mu = sd = None
    if a.zscore:
        mu, sd = X.mean(0), X.std(0) + 1e-4
        X = ((X - mu) / sd).astype(np.float32)
    print(f"{ndrop} clips dropped by the exclude list", flush=True)
    vocab = sorted({t for ts in tags for t in ts})
    cnt = {t: 0 for t in vocab}
    for ts in tags:
        for t in ts:
            cnt[t] += 1
    vocab = [t for t in vocab if cnt[t] >= a.min_pos]
    ix = {t: i for i, t in enumerate(vocab)}
    Y = np.zeros((len(X), len(vocab)), np.float32)
    for n, ts in enumerate(tags):
        for t in ts:
            if t in ix:
                Y[n, ix[t]] = 1
    fold = np.array([int(hashlib.sha256(f"dge-r11|{g}".encode()).hexdigest()[:8], 16) % a.folds for g in groups])
    print(f"{len(X)} clips, {len(vocab)} tags, {a.folds} folds by group", flush=True)

    Xt, Yt = torch.from_numpy(X), torch.from_numpy(Y)
    charts.start(os.environ.get('TRACKIO_RUN') or 'round11-teacher-' + os.path.basename(a.out.rstrip('/')),
                 {'clips': len(X), 'tags': len(vocab), 'folds': a.folds, 'epochs': a.epochs, 'model': f'{a.feats} MLP teacher'})
    S = np.zeros_like(Y)  # out-of-fold scores: thresholds are frozen on these, never on held-out clips
    states = []
    for k in range(a.folds):
        torch.manual_seed(k)
        tr, va = np.where(fold != k)[0], np.where(fold == k)[0]
        pos = Y[tr].sum(0)
        pw = torch.from_numpy(np.clip((len(tr) - pos) / np.maximum(pos, 1), 1, 30) ** 0.5).float()
        model = Head(X.shape[1], len(vocab))
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
            charts.log({'epoch': k * a.epochs + ep + 1, 'fold': k, 'loss': tot / len(tr)}, step=k * a.epochs + ep + 1)
        model.eval()
        with torch.no_grad():
            S[va] = torch.sigmoid(model(Xt[va])).numpy()
        states.append(model.state_dict())
        print(f"fold {k} done, loss {tot / len(tr):.4f}", flush=True)
    thr, rep = {}, {}
    for t, i in ix.items():
        r = pick(S[:, i], Y[:, i] > 0)
        rep[t] = {"pos": int(Y[:, i].sum())}
        if r:
            thr[t] = r[0]; rep[t].update(oof_p=round(r[1], 3), oof_r=round(r[2], 3))
    vals = [min(v['oof_p'], v['oof_r']) for v in rep.values() if 'oof_p' in v]
    charts.log({'epoch': a.folds * a.epochs, 'oof_mean_min_pr': float(np.mean(vals)) if vals else 0.0, 'oof_tags_50': sum(v >= .5 for v in vals),
                'oof_tags_60': sum(v >= .6 for v in vals), 'oof_tags_70': sum(v >= .7 for v in vals)}, step=a.folds * a.epochs)
    charts.finish()
    # the teacher is the average of the fold models; each was fit without one fold of groups
    torch.save({"states": states, "vocab": vocab, "dim": X.shape[1], "kind": a.feats,
                "mu": None if mu is None else torch.from_numpy(mu), "sd": None if sd is None else torch.from_numpy(sd)}, os.path.join(a.out, "teacher.pt"))
    json.dump(thr, open(os.path.join(a.out, "thresholds.json"), "w"), indent=1)
    json.dump(rep, open(os.path.join(a.out, "val.json"), "w"), indent=1)
    print(f"{len(thr)} tags with a frozen threshold", flush=True)


if __name__ == "__main__":
    main()
