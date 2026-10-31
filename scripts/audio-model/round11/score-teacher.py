"""Score the round 11 teacher on held-out real clips. LOCAL ONLY: the judge sets never leave this machine.

python3 score-teacher.py <teacher dir> <heldout-feats.npz> <out.json> [more-feats.npz ...]
Per clip: max teacher probability over its 10 s windows (the app's view). Thresholds come frozen from the teacher's
training-side validation split (fit-teacher.py). Each set is scored on its own; a set counts for a tag with >= 5
positives; a tag passes a bar when every counted set clears it and at least one counted set has negatives
(reports/tagger-run7-2026-10-10/score_run.py). Weak view: an unlabelled clip counts as a negative (precision is a
lower bound), as the scoreboard does for the free-tag-set test half.
"""
import csv, importlib.util, json, os, sys
from collections import defaultdict

import numpy as np
import torch

D = "/mnt/project-files/datasets"
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ft", os.path.join(here, "fit-teacher.py"))
ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)


def split_tags(s):
    return {t.strip() for t in s.replace("|", ";").split(";") if t.strip()}


def load_sets():
    side = {r["path"]: r["split"] for r in csv.DictReader(open(f"{D}/commercial-split/split.csv")) if r["set"] == "free-tag-set"}
    sets = {
        "free-tag-set test": [(f"{D}/free-tag-set/{r['path']}", split_tags(r["present_tags"]), split_tags(r["absent_tags"]))
                              for r in csv.DictReader(open(f"{D}/free-tag-set/labels.csv")) if side.get(r["path"]) == "test"],
        "splice": [(r["path"], split_tags(r["present_tags"]), split_tags(r["absent_tags"]))
                   for r in csv.DictReader(open(f"{D}/splice-shortlist/labels.csv"))],
        "chris-drive judge": [(f"{D}/chris-drive/{r['path']}", split_tags(r["present_tags"]), split_tags(r["absent_tags"]))
                              for r in csv.DictReader(open(f"{D}/chris-drive/labels.csv")) if r["split"] == "judge"],
    }
    t8 = defaultdict(set)
    for r in csv.DictReader(open(f"{D}/test8-untested-tags/manifest.csv")):
        t8[f"{D}/test8-untested-tags/audio/{r['file']}"].add(r["tag"])
    sets["test8 freesound"] = [(p, ts, set()) for p, ts in t8.items()]
    return sets


def main():
    tdir, npz, out = sys.argv[1:4]
    f, vocab, kind = ft.load(os.path.join(tdir, "teacher.pt"))
    thr = json.load(open(os.path.join(tdir, "thresholds.json")))
    z = dict(np.load(npz))
    for extra in sys.argv[4:]:  # more feature files for the same clips (e.g. CLAP computed separately), joined by path
        e = np.load(extra); ix = {(str(p), int(w)): i for i, (p, w) in enumerate(zip(e["path"], e["win"]))}
        keep = [i for i, k in enumerate(zip(z["path"], z["win"])) if (str(k[0]), int(k[1])) in ix]
        z = {k: v[keep] for k, v in z.items()}
        for k in e.files:
            if k not in z:
                z[k] = e[k][[ix[(str(p), int(w))] for p, w in zip(z["path"], z["win"])]]
    S = f(ft.feats(z, kind))
    prob = {}
    for p, s in zip(z["path"], S):
        prob[str(p)] = np.maximum(prob[str(p)], s) if str(p) in prob else s
    sets = load_sets()
    res = {}
    for t, th in thr.items():
        i = vocab.index(t); rows = []
        for name, clips in sets.items():
            tp = fp = pos = neg = 0
            for path, present, absent in clips:
                if path not in prob:
                    continue
                lab = 1 if t in present else 0
                hit = prob[path][i] >= th
                pos += lab; neg += 1 - lab; tp += hit and lab; fp += hit and not lab
            if pos >= 5:
                rows.append(dict(set=name, p=round(tp / (tp + fp), 3) if tp + fp else 0.0, r=round(tp / pos, 3), pos=pos, neg=neg))
        if not rows:
            continue
        low = lambda x: min(x["p"], x["r"]) if x["neg"] else x["r"]  # noqa: E731
        ok = lambda x, b: x["r"] >= b and (not x["neg"] or x["p"] >= b)  # noqa: E731
        bars = {str(b): any(x["neg"] for x in rows) and all(ok(x, b) for x in rows) for b in (0.5, 0.6, 0.7)}
        lim = min(rows, key=low)
        res[t] = dict(threshold=round(th, 4), rows=rows, bars=bars, p=lim["p"], r=lim["r"], limiting=lim["set"])
    json.dump(res, open(out, "w"), indent=1)
    n = {b: sum(v["bars"][b] for v in res.values()) for b in ("0.5", "0.6", "0.7")}
    print(f"{len(res)} tags scored; pass 50/60/70: {n['0.5']}/{n['0.6']}/{n['0.7']}")


if __name__ == "__main__":
    main()
