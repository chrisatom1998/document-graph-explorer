"""Fair before-and-after test for the desktop Dasheng add-on (src/audio/dasheng*.ts). LOCAL ONLY: held-out audio never
leaves the project container.

python3 score-dasheng-addon.py <model dir (model.onnx, model.json)> <policy json> <sets dir> <out dir>
    [--cutoffs name=cutoffs.json ...] [--baseline latest.json] [--skip-sets free-tag-set-holdout,freesound-reserved]

The sets dir holds the scoreboard's fresh test sets (<set>.csv: id, path, group, present, absent, weak; ';'-separated
tags). Only clips that label at least one policy tag (present or absent) are scored. Each clip
is read the way the app reads it (src/audio/tagger.ts taggerWindowStarts + dashengPass.ts): whole 10 s windows from the
start, the middle 30 s of longer audio, each window its own unpadded 16 kHz audio (at least 0.25 s), and the best window
decides. Per-clip scores go to <out dir>/<set>.npz (container only) so cutoffs can be re-checked without rescoring.

Pass rules are the scoreboard's headline (reports/scoreboard/scripts/build_scoreboard.py): strong labels only; a set
counts for a tag with >= 5 positives; a tag passes a bar when every counted set reaches that precision AND recall and at
least one counted set has negatives, and fails every bar when it fires on more than 1% of the negatives of a set that
cannot count it (< 5 positives, >= 50 negatives). Cutoffs come from the policy
and from each --cutoffs file (picked on training clips by dasheng-oof-cutoffs.py), never from these clips. --baseline
adds the scoreboard's row for the same tag (the app before the add-on).
"""
import argparse, csv, glob, json, math, os, sys, time

import numpy as np

SR, WIN, MAXW, MIN, MIN_POS, FA_CAP, FA_MIN_NEG = 16000, 10.0, 3, 4000, 5, 0.01, 50
BARS = {"50/50": (.5, .5), "60/30": (.6, .3), "50/30": (.5, .3), "60/60": (.6, .6), "70/70": (.7, .7)}


def starts(duration):
    if not math.isfinite(duration) or duration <= 0:
        return []
    whole = math.floor(duration / WIN + 1e-6)
    if whole <= MAXW:
        return [k * WIN for k in range(max(1, whole))]
    first = (duration - MAXW * WIN) / 2
    return [first + k * WIN for k in range(MAXW)]


def load(path):
    import av, soxr

    with av.open(path) as c:
        st = c.streams.audio[0]
        sr = st.rate or 48000
        rs = av.AudioResampler(format="flt", layout="mono", rate=sr)
        x = np.concatenate([g.to_ndarray().reshape(-1) for fr in c.decode(st) for g in rs.resample(fr)]).astype(np.float32)
    return soxr.resample(x, sr, SR).astype(np.float32) if sr != SR else x


def label(row, tag):
    """Strong labels only, as the scoreboard's headline: unlabelled tags are skipped, weak sets included."""
    if tag in set(filter(None, row["present"].split(";"))):
        return 1
    if tag in set(filter(None, row["absent"].split(";"))):
        return 0
    return None


def evaluate(rows, scores, tags, cut):
    out = {}
    for t, j in tags.items():
        if cut.get(t) is None:
            out[t] = {"cutoff": None, "sets": {}}
            continue
        per = {}
        for name in rows:
            tp = fp = pos = neg = 0
            for r, s in zip(rows[name], scores[name]):
                y = label(r, t)
                if y is None or s is None:
                    continue
                hit = bool(s[j] >= cut[t])
                if y:
                    pos += 1; tp += hit
                else:
                    neg += 1; fp += hit
            if pos or neg:
                per[name] = {"precision": round(tp / (tp + fp), 3) if tp + fp else (0.0 if pos else None),
                             "recall": round(tp / pos, 3) if pos else None, "positives": pos, "negatives": neg, "tp": tp, "fp": fp,
                             "counted": pos >= MIN_POS}
        counted = {k: v for k, v in per.items() if v["counted"]}
        measured = bool(counted) and any(v["negatives"] for v in counted.values())
        # false-alarm cap: a set that cannot count the tag (< 5 positives) but has >= 50 negatives fails it above 1% firing
        breach = [k for k, v in per.items() if not v["counted"] and v["negatives"] >= FA_MIN_NEG and v["fp"] / v["negatives"] > FA_CAP]
        row = {"cutoff": round(float(cut[t]), 5), "measured": measured, "falseAlarmCapBreached": breach, "sets": per}
        for b, (p, rc) in BARS.items():
            row[b] = measured and not breach and all((v["precision"] or 0) >= p and (v["recall"] or 0) >= rc for v in counted.values())
        out[t] = row
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model"); ap.add_argument("policy"); ap.add_argument("sets"); ap.add_argument("out")
    ap.add_argument("--cutoffs", action="append", default=[], help="name=cutoffs.json (dasheng-oof-cutoffs.py output)")
    ap.add_argument("--baseline"); ap.add_argument("--skip-sets", default="free-tag-set-holdout,freesound-reserved")
    ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    classes = json.load(open(os.path.join(a.model, "model.json")))["classes"]
    pol = json.load(open(a.policy))
    tags = {t["output"]: classes.index(t["output"]) for t in pol["tags"]}
    rows, scores = {}, {}
    for f in sorted(glob.glob(os.path.join(a.sets, "*.csv"))):
        name = os.path.basename(f)[:-4]
        if name in a.skip_sets.split(","):
            continue
        sel = [r for r in csv.DictReader(open(f, newline="", encoding="utf-8")) if any(label(r, t) is not None for t in tags)]
        if sel:
            rows[name] = sel
    sess = None
    for name, sel in rows.items():
        cache = os.path.join(a.out, f"{name}.npz")
        if os.path.exists(cache):
            z = np.load(cache, allow_pickle=False)
            got = {i: (s if ok else None) for i, s, ok in zip(z["ids"], z["scores"], z["ok"])}
            if all(r["id"] in got for r in sel):
                scores[name] = [got[r["id"]] for r in sel]
                print(f"{name}: {len(sel)} clips from cache", flush=True)
                continue
        if sess is None:
            import onnxruntime as ort

            so = ort.SessionOptions(); so.intra_op_num_threads = a.threads
            sess = ort.InferenceSession(os.path.join(a.model, "model.onnx"), so, providers=["CPUExecutionProvider"])
        out, t0 = [], time.time()
        for n, r in enumerate(sel):
            try:
                x = load(r["path"])
            except Exception as e:  # an unreadable clip is reported, never silently scored as negative
                print(f"decode failed: {r['id']}: {e}", file=sys.stderr)
                out.append(None)
                continue
            best = np.zeros(len(classes), np.float32)
            for s in starts(x.shape[0] / SR):
                w = x[int(s * SR): int(s * SR) + int(WIN * SR)]
                if w.shape[0] < MIN:
                    w = np.pad(w, (0, MIN - w.shape[0]))
                best = np.maximum(best, sess.run(None, {"samples16k": w[None]})[0][0])
            out.append(best)
            if n % 100 == 0:
                print(f"{name}: {n}/{len(sel)} clips, {time.time() - t0:.0f}s", flush=True)
        scores[name] = out
        np.savez(cache, ids=np.array([r["id"] for r in sel]), ok=np.array([s is not None for s in out]),
                 scores=np.stack([s if s is not None else np.zeros(len(classes), np.float32) for s in out]), classes=np.array(classes))
    cuts = {"policy": {t["output"]: t["threshold"] for t in pol["tags"]}}
    for c in a.cutoffs:
        k, p = c.split("=", 1)
        cuts[k] = {t: v.get("threshold") for t, v in json.load(open(p))["tags"].items()}
    base = {r["tag"]: r for r in json.load(open(a.baseline))["tags"]} if a.baseline else {}
    res = {"revision": pol["revision"], "modelSha256": pol["modelSha256"],
           "note": "fresh test sets (Oct 11 2026): new numbers, not comparable with scores before Oct 11 2026",
           "clips": {k: len(v) for k, v in rows.items()}, "skipped": {k: sum(s is None for s in v) for k, v in scores.items()},
           "cutoffs": {}}
    for k, c in cuts.items():
        res["cutoffs"][k] = evaluate(rows, scores, tags, c)
    if base:
        res["before"] = {t: {b: base[t].get(f"pass{b.split('/')[0]}") if b.split("/")[0] == b.split("/")[1] else None for b in BARS}
                         | {"precision": base[t].get("precision"), "recall": base[t].get("recall"), "sets": base[t].get("sets"),
                            "output": base[t].get("output"), "threshold": base[t].get("threshold"), "status": base[t].get("status")}
                         for t in tags if t in base}
    json.dump(res, open(os.path.join(a.out, "result.json"), "w"), indent=1)
    for k, c in res["cutoffs"].items():
        print(f"\ncutoffs: {k}")
        for t, v in c.items():
            sets = "  ".join(f"{n} P {s['precision']} R {s['recall']} ({s['positives']}+/{s['negatives']}-)" for n, s in v["sets"].items())
            print(f"  {t:15s} cut {v['cutoff']}  " + " ".join(b for b in BARS if v.get(b)) + f"  | {sets}")


if __name__ == "__main__":
    main()
