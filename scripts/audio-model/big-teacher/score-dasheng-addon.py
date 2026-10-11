"""Fair before-and-after test for the desktop Dasheng add-on (src/audio/dasheng*.ts). LOCAL ONLY: held-out audio never
leaves the project container.

python3 score-dasheng-addon.py <model dir (model.onnx, model.json)> <policy json> <clips.csv> <out.json> [--baseline latest.json]

clips.csv: path, tags ('|'-separated, complete labels for that set) and set. Each clip is read the way the app reads it
(src/audio/tagger.ts taggerWindowStarts + dashengPass.ts): whole 10 s windows from the start, the middle 30 s of longer
audio, each window its own unpadded 16 kHz audio (at least 0.25 s), and the best window decides. Precision and recall per
tag and set use the policy's thresholds as shipped; thresholds are never picked on these clips. --baseline adds the
scoreboard's numbers for the same tags (the app before the add-on) when the scoreboard lists them per set.
"""
import argparse, csv, json, math, os, sys, time

import numpy as np

SR, WIN, MAXW, MIN = 16000, 10.0, 3, 4000


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model"); ap.add_argument("policy"); ap.add_argument("clips"); ap.add_argument("out")
    ap.add_argument("--baseline"); ap.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    a = ap.parse_args()
    import onnxruntime as ort

    so = ort.SessionOptions(); so.intra_op_num_threads = a.threads
    sess = ort.InferenceSession(os.path.join(a.model, "model.onnx"), so, providers=["CPUExecutionProvider"])
    classes = json.load(open(os.path.join(a.model, "model.json")))["classes"]
    pol = json.load(open(a.policy))
    tags = [t["output"] for t in pol["tags"]]
    th = {t["output"]: t["threshold"] for t in pol["tags"]}
    ix = [classes.index(t) for t in tags]
    rows = list(csv.DictReader(open(a.clips, newline="", encoding="utf-8")))
    scores, t0 = [], time.time()
    for n, r in enumerate(rows):
        try:
            x = load(r["path"])
        except Exception as e:  # an unreadable clip is reported, never silently scored as negative
            print(f"decode failed: {r['path']}: {e}", file=sys.stderr)
            scores.append(None)
            continue
        best = np.zeros(len(tags), np.float32)
        for s in starts(x.shape[0] / SR):
            w = x[int(s * SR): int(s * SR) + int(WIN * SR)]
            if w.shape[0] < MIN:
                w = np.pad(w, (0, MIN - w.shape[0]))
            best = np.maximum(best, sess.run(None, {"samples16k": w[None]})[0][0][ix])
        scores.append(best)
        if n % 100 == 0:
            print(f"{n}/{len(rows)} clips, {time.time() - t0:.0f}s", flush=True)
    base = json.load(open(a.baseline)) if a.baseline else None
    out = {"revision": pol["revision"], "modelSha256": pol["modelSha256"], "note": "new test sets; not comparable with scores before Oct 11 2026",
           "skipped": sum(s is None for s in scores), "sets": {}}
    for name in sorted({r["set"] for r in rows}):
        sel = [(r, s) for r, s in zip(rows, scores) if r["set"] == name and s is not None]
        res = {}
        for k, t in enumerate(tags):
            y = np.array([t in r["tags"].split("|") for r, _ in sel]); p = np.array([s[k] >= th[t] for _, s in sel])
            tp = int((y & p).sum())
            res[t] = {"pos": int(y.sum()), "neg": int((~y).sum()), "tp": tp, "fp": int((~y & p).sum()),
                      "precision": round(tp / p.sum(), 3) if p.sum() else None, "recall": round(tp / y.sum(), 3) if y.sum() else None}
            before = (((base or {}).get("sets") or {}).get(name) or {}).get(t) if base else None
            if before:
                res[t]["before"] = before
        out["sets"][name] = {"clips": len(sel), "tags": res}
    json.dump(out, open(a.out, "w"), indent=1)
    for name, s in out["sets"].items():
        print(f"\n{name} ({s['clips']} clips)")
        for t, v in s["tags"].items():
            print(f"  {t:15s} pos {v['pos']:4d}  P {v['precision']}  R {v['recall']}")


if __name__ == "__main__":
    main()
