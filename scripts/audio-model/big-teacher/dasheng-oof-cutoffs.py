"""Precision-first cutoffs for the desktop Dasheng add-on, picked on the teacher's out-of-fold scores (training clips only).

python3 dasheng-oof-cutoffs.py <teach-das dir (teacher.pt)> <features dir (bigteacher *.npz)> <manifests dir> <kept ids.csv> <out.json>
    [--tags "tom|drum fill|..."] [--precision 0.5]

teacher.pt holds the five fold heads; fold k was fit without the groups that round11/fit-teacher.py hashes into fold k, so
scoring each training clip with its own fold's head gives the same out-of-fold scores fit-teacher.py froze its balanced
cutoffs on. kept ids.csv (column id) is the manifest rows that survived the private exclude filter. For each tag this picks
the lowest cutoff whose out-of-fold precision is at least --precision (the most recall that keeps precision there), with at
least 10 positives and 10 negatives. No held-out (test) clip is read here.
"""
import argparse, csv, glob, hashlib, json, os

import numpy as np
import torch
import torch.nn as nn


class Head(nn.Module):  # round11/fit-teacher.py
    def __init__(self, d, k, h=768):
        super().__init__()
        self.norm = nn.LayerNorm(d)
        self.net = nn.Sequential(nn.Dropout(0.2), nn.Linear(d, h), nn.GELU(), nn.Dropout(0.3), nn.Linear(h, k))

    def forward(self, x):
        return self.net(self.norm(x))


def precision_first(s, y, p_min, min_n=10):
    if y.sum() < min_n or (~y).sum() < min_n:
        return None
    o = np.argsort(-s); s, y = s[o], y[o]
    tp = np.cumsum(y); k = np.arange(1, len(y) + 1); prec = tp / k; rec = tp / y.sum()
    last = np.r_[s[1:] != s[:-1], True]  # only cut between distinct scores
    ok = np.where(last & (prec >= p_min))[0]
    if not len(ok):
        return {"threshold": None, "oof_p": None, "oof_r": 0.0}
    i = ok[np.argmax(rec[ok])]
    return {"threshold": float(s[i]), "oof_p": round(float(prec[i]), 3), "oof_r": round(float(rec[i]), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("teacher"); ap.add_argument("feat"); ap.add_argument("manifests"); ap.add_argument("kept"); ap.add_argument("out")
    ap.add_argument("--tags", default="tom|drum fill|conga|djembe|breakbeat|shaker|reverse cymbal")
    ap.add_argument("--precision", type=float, default=0.5); ap.add_argument("--folds", type=int, default=5)
    a = ap.parse_args()
    ck = torch.load(os.path.join(a.teacher, "teacher.pt"), map_location="cpu", weights_only=False)
    vocab, mu, sd = ck["vocab"], ck["mu"].numpy(), ck["sd"].numpy()
    heads = []
    for st in ck["states"]:
        h = Head(ck["dim"], len(vocab)); h.load_state_dict(st); h.eval(); heads.append(h)
    kept = {r["id"] for r in csv.DictReader(open(a.kept, newline="", encoding="utf-8"))}
    man = {}
    for m in glob.glob(os.path.join(a.manifests, "*.csv")):
        d = os.path.basename(m)[:-4].split("__")[-1]
        for r in csv.DictReader(open(m, newline="", encoding="utf-8")):
            if r.get("split", "train") == "train" and r["id"] in kept:
                man[f"{d}/{r['file']}"] = r
    tags = a.tags.split("|"); ix = [vocab.index(t) for t in tags]
    S, Y = [], []
    for f in sorted(glob.glob(os.path.join(a.feat, "*.npz"))):
        z = np.load(f)
        sel = [i for i, c in enumerate(z["id"]) if str(c) in man]
        if not sel:
            continue
        x = torch.from_numpy(((z["das"][sel].astype(np.float32) - mu) / sd).astype(np.float32))
        rows = [man[str(z["id"][i])] for i in sel]
        fold = np.array([int(hashlib.sha256(f"dge-r11|{r['group']}".encode()).hexdigest()[:8], 16) % a.folds for r in rows])
        s = np.zeros((len(sel), len(tags)), np.float32)
        with torch.no_grad():
            for k in range(a.folds):
                m = fold == k
                if m.any():
                    s[m] = torch.sigmoid(heads[k](x[m])).numpy()[:, ix]
        S.append(s)
        Y.append(np.array([[t in r["tags"].split("|") for t in tags] for r in rows]))
    S, Y = np.concatenate(S), np.concatenate(Y)
    out = {"precisionFloor": a.precision, "clips": int(len(S)), "note": "out-of-fold scores on training clips after the private exclude filter", "tags": {}}
    for j, t in enumerate(tags):
        r = precision_first(S[:, j], Y[:, j], a.precision) or {"threshold": None}
        out["tags"][t] = {"pos": int(Y[:, j].sum()), **r}
        print(t, out["tags"][t], flush=True)
    json.dump(out, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
