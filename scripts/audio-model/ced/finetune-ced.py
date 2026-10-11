# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "torch>=2.3",
#   "torchaudio>=2.3",
#   "transformers>=4.40,<5",
#   "huggingface_hub>=0.25",
#   "numpy",
#   "av>=12",
#   "trackio",
# ]
# ///
"""Big-listener round: fine-tune CED-base (mispeech/ced-base, Apache 2.0, 86M parameters) end to end on DGE tags.

Every tagger round so far retrains the 4M-parameter EfficientAT student, and the teacher runs only fit small heads on
frozen CED/CLAP features. This run lets the whole big model learn our sounds.

Data (private dataset cmjatom/dge-private-train, train halves only):
- round13/manifest-v1.csv rows with keep=1, split=train (held-out uploaders, ids and duplicates already dropped)
- run9/v1-audit/manifest-audited.csv rows with keep=1, split=train
- extra item ids to leave out: tagger-r14/v1/drop-train-ids.json
Validation: one group in ten (uploader / performer / take, by hash) of the train rows; picks each tag's threshold.
Test: run 9's held-out rows (keep=1, split=heldout; public Freesound sources, never trained or tuned on).
No judge set is read here. Train audio that decodes to the same PCM as a test clip is dropped.

Labels: an item's own tags are positives (plus the parent of a merged tag); every other tag is a weak negative with
weight WEAK (default 0.2), and weight 0 when the tag often co-occurs with one the item has (e.g. drums for a kick).
Clips up to 30 s are kept; training uses a random 10 s crop, scoring takes the max over 10 s windows (as the app does).
Short clips are not looped: each batch holds clips of one length bucket (1, 2, 4, 6 or 10 s), zero-padded to it.

Env: OUT (output dir, e.g. a mounted bucket), BUDGET_MIN (whole-job minutes; training stops in time to score and
save), EPOCHS (max, default 8), BATCH (64), LR (backbone, 3e-5), HEAD_LR (1e-3), WEAK (0.2), MIN_POS (25),
MIRROR (copy of the outputs as they are written), ONLY_PARTS (comma list of manifest parts, smoke test), MAX_TARS (smoke test), UPLOAD_REPO / UPLOAD_PATH (model repo
copy at the end), TRACKIO_SPACE / TRACKIO_RUN (live charts: aggregates only).
"""
import csv
import hashlib
import io
import json
import math
import os
import random
import sys
import tarfile
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

T0 = time.time()
# one thread per decode worker and plain HTTP downloads: 20 workers x (BLAS + ffmpeg + xet) threads hit the job's
# thread limit ("failed to spawn thread") in the first launch
for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_k, "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
import numpy as np  # noqa: E402  (after the thread limits)
REPO = "cmjatom/dge-private-train"
SR = 16000
MAX_S = 30
WIN = 10 * SR
BUCKETS = [1, 2, 4, 6, 10]
MANIFESTS = [("round13/manifest-v1.csv", "round13/"), ("run9/v1-audit/manifest-audited.csv", "")]
DROP_IDS = "tagger-r14/v1/drop-train-ids.json"
# a merged-away tag also teaches the tag it is shown as (record stop stays its own tag: Chris, Oct 10)
PARENT = {
    "foghorn bass": "synth bass", "stutter effect": "glitch effect", "foley hit": "foley", "percussion hit": "percussion",
    "closed hi-hat": "hi-hat", "vocal-like synth": "vocoder vocal", "noise": "static noise", "vocal breath": "breath",
    "synth stab": "synth hit", "downlifter": "falling", "turntable": "vinyl scratch", "vocal harmony": "choir",
    "acid bass": "acid synth",
}
H = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)  # noqa: E731
env = os.environ.get
mins = lambda: (time.time() - T0) / 60  # noqa: E731


def log(*a):
    print(f"[{mins():6.1f} min]", *a, flush=True)


def decode(b):
    """bytes -> int16 mono 16 kHz, first MAX_S seconds, or None."""
    try:
        import av

        with av.open(io.BytesIO(b)) as c:
            st = c.streams.audio[0]
            rs = av.AudioResampler(format="flt", layout="mono", rate=SR)
            out, n = [], 0
            for fr in c.decode(st):
                for g in rs.resample(fr):
                    a = g.to_ndarray().reshape(-1)
                    out.append(a)
                    n += a.size
                if n >= MAX_S * SR:
                    break
            for g in rs.resample(None):
                out.append(g.to_ndarray().reshape(-1))
        x = np.concatenate(out)[: MAX_S * SR] if out else np.zeros(0, np.float32)
        if x.shape[0] < SR // 10:
            return None
        return (np.clip(x, -1, 1) * 32767).astype(np.int16)
    except Exception:  # noqa: BLE001
        return None


def load_rows():
    from huggingface_hub import hf_hub_download

    drop = set(json.load(open(hf_hub_download(REPO, DROP_IDS, repo_type="dataset"))))
    only = [p for p in (env("ONLY_PARTS") or "").split(",") if p]
    rows = []
    for man, prefix in MANIFESTS:
        for r in csv.DictReader(open(hf_hub_download(REPO, man, repo_type="dataset"), newline="", encoding="utf-8")):
            if r["keep"] != "1" or r["split"] not in ("train", "heldout") or r["id"] in drop:
                continue
            if only and r["part"] not in only:
                continue
            tar, member = r["file"].split("/", 1)
            r["tar"] = f"{prefix}{r['part']}/{tar}"
            r["member"] = member
            rows.append(r)
    com = env("COMMERCIAL")  # mounted private bucket folder with labels/labels.csv (round 10's commercial packs, train split)
    if com and not only:
        keep_com = None
        if env("COMMERCIAL_KEEP"):  # leak-cleaned allowlist (bigteacher/keep-v1.csv: ids are the pack paths)
            keep_com = {r["id"] for r in csv.DictReader(open(env("COMMERCIAL_KEEP"), newline="", encoding="utf-8"))}
        n0 = len(rows)
        for r in csv.DictReader(open(os.path.join(com, "labels", "labels.csv"), newline="", encoding="utf-8")):
            if r["split"] != "train" or not r["present_tags"].strip():
                continue
            if keep_com is not None and r["path"] not in keep_com:
                continue
            rid = "commercial/" + r["path"]
            if rid in drop or "round10:" + r["source"] + ":" + r["path"] in drop:
                continue
            rows.append({"id": rid, "split": "train", "group": f"{r['source']}:{r['group']}", "pcm_sha256": r["pcm16k_sha256"],
                         "tags": r["present_tags"].replace(";", "|"), "absent": r["absent_tags"].replace(";", "|"),
                         "file_path": os.path.join(com, r["path"]), "tar": None, "member": None, "part": "commercial"})
        log(f"commercial: {len(rows) - n0} labelled train rows")
    if env("KEEP_IDS"):  # training ids that passed the fresh exclude-list check (built in the project container)
        from huggingface_hub import hf_hub_download as _d

        keep = set(open(_d(REPO, env("KEEP_IDS"), repo_type="dataset"), encoding="utf-8").read().split("\n"))
        n0 = sum(r["split"] == "train" for r in rows)
        rows = [r for r in rows if r["split"] != "train" or r["id"] in keep]
        log(f"exclude-list keep file: {n0 - sum(r['split'] == 'train' for r in rows)} train rows dropped")
    test_pcm = {r["pcm_sha256"] for r in rows if r["split"] == "heldout" and r["pcm_sha256"]}
    seen, kept = set(), []
    for r in rows:
        if r["split"] == "train":
            if r["pcm_sha256"] and (r["pcm_sha256"] in test_pcm or r["pcm_sha256"] in seen):
                continue
            seen.add(r["pcm_sha256"])
        tags = {t for t in r["tags"].split("|") if t}
        tags |= {PARENT[t] for t in tags if t in PARENT}
        r["tagset"] = tags
        r["absentset"] = {t for t in (r.get("absent") or "").split("|") if t} - tags
        kept.append(r)
    log(f"{len(kept)} rows ({sum(r['split'] == 'train' for r in kept)} train, {sum(r['split'] == 'heldout' for r in kept)} test)")
    return kept


def load_audio(rows):
    """Download each tar once and decode the rows it holds; tars are deleted after use."""
    from huggingface_hub import hf_hub_download

    by_tar = defaultdict(dict)
    files = []
    for i, r in enumerate(rows):
        if r.get("file_path"):
            files.append(i)
        else:
            by_tar[r["tar"]][r["member"]] = i
    tars = sorted(by_tar)
    if env("MAX_TARS"):
        tars = tars[: int(env("MAX_TARS"))]
    audio = [None] * len(rows)
    pool = ProcessPoolExecutor(int(env("DECODE_WORKERS", "12")))
    lock = threading.Lock()
    done = [0]

    def one(t):
        for attempt in range(5):
            try:
                p = hf_hub_download(REPO, t, repo_type="dataset", cache_dir="/tmp/hfcache")
                break
            except BaseException as e:  # noqa: BLE001  (the xet downloader can panic when the container is out of threads)
                if isinstance(e, KeyboardInterrupt):
                    raise
                log(f"download retry {t}: {e!r}")
                time.sleep(5 * (attempt + 1))
        else:
            log(f"download FAILED {t}")
            return
        want = by_tar[t]
        idx, blobs = [], []
        with tarfile.open(p, "r|*") as tf:
            for m in tf:
                if m.isfile() and m.name in want:
                    idx.append(want[m.name])
                    blobs.append(tf.extractfile(m).read())
        for i, x in zip(idx, pool.map(decode, blobs, chunksize=8)):
            audio[i] = x
        try:
            os.remove(os.path.realpath(p))
        except OSError:
            pass
        with lock:
            done[0] += 1
            log(f"tar {done[0]}/{len(tars)} {t}: {len(idx)} of {len(want)} found")

    with ThreadPoolExecutor(int(env("DL_THREADS", "2"))) as ex:
        list(ex.map(one, tars))
    def read(i):
        try:
            with open(rows[i]["file_path"], "rb") as fh:
                return fh.read()
        except OSError as e:
            log(f"read failed {rows[i]['file_path']}: {e}")
            return b""

    # a mounted bucket answers one file at a time slowly (~6 files/s serially, measured), so read many at once
    reader = ThreadPoolExecutor(int(env("READ_THREADS", "64")))
    for k in range(0, len(files), 2000):  # files on a mounted bucket (commercial packs)
        chunk = files[k : k + 2000]
        blobs = list(reader.map(read, chunk))
        for i, x in zip(chunk, pool.map(decode, blobs, chunksize=8)):
            audio[i] = x
        log(f"files {min(k + 2000, len(files))}/{len(files)}")
    pool.shutdown()
    return audio


def bucket_of(n):
    s = n / SR
    for b in BUCKETS:
        if s <= b + 1e-6:
            return b
    return BUCKETS[-1]


def main():
    import torch
    import torch.nn as nn
    import torchaudio.transforms as T
    from transformers import AutoModelForAudioClassification

    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:0] = [here, os.path.dirname(here)]  # charts.py sits beside this file in a job, one folder up in the repo
    try:
        import charts
    except Exception:  # noqa: BLE001
        charts = None
    try:  # older trackio builds (the ones that resolve beside transformers<5) have no bucket_id argument
        import inspect

        import trackio

        if "bucket_id" not in inspect.signature(trackio.init).parameters:
            _init = trackio.init
            trackio.init = lambda *a, bucket_id=None, **k: _init(*a, **k)
    except Exception:  # noqa: BLE001
        pass

    out = env("OUT", "ced-out")
    os.makedirs(out, exist_ok=True)
    budget = float(env("BUDGET_MIN", "95"))
    max_epochs = int(env("EPOCHS", "8"))
    B = int(env("BATCH", "64"))
    weak = float(env("WEAK", "0.2"))
    min_pos = int(env("MIN_POS", "25"))
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    seed = 1013
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    log(f"device {dev} {torch.cuda.get_device_name() if dev == 'cuda' else ''} torch {torch.__version__}")
    if dev == "cuda":
        torch.ones(8, device=dev).sum().item()  # fail fast on a GPU this torch build can't drive
    rows = load_rows()
    score_only = env("SCORE_ONLY")  # path to a trained model.pt: skip training, decode only validation + test
    is_train = lambda r: r["split"] == "train" and H("val|" + r["group"]) % 10  # noqa: E731
    cnt = Counter(t for r in rows if is_train(r) for t in r["tagset"])  # from the manifests, so a scoring run gets the same classes
    if score_only:
        rows = [r for r in rows if not is_train(r)]
    audio = load_audio(rows)
    ok = [i for i, a in enumerate(audio) if a is not None]
    log(f"decoded {len(ok)} of {len(rows)}; {sum(a.nbytes for a in audio if a is not None) / 1e9:.1f} GB in RAM")
    train = [i for i in ok if is_train(rows[i])]
    val = [i for i in ok if rows[i]["split"] == "train" and not is_train(rows[i])]
    test = [i for i in ok if rows[i]["split"] == "heldout"]
    classes = sorted(t for t, n in cnt.items() if n >= min_pos)
    K = len(classes)
    ci = {t: k for k, t in enumerate(classes)}
    log(f"{K} classes; train {len(train)}, val {len(val)}, test {len(test)}")

    Y = np.zeros((len(rows), K), np.float32)
    A = np.zeros((len(rows), K), bool)  # labelled absent (commercial packs): a full-weight negative
    for i in ok:
        for t in rows[i]["tagset"]:
            if t in ci:
                Y[i, ci[t]] = 1
        for t in rows[i]["absentset"]:
            if t in ci:
                A[i, ci[t]] = True
    # co-occurrence: when an item has a, an absent b with P(b | a) >= 0.1 is not taught as a negative
    tr = Y[train]
    co = (tr.T @ tr) / np.maximum(tr.sum(0)[:, None], 1)
    implied = co >= 0.1
    np.fill_diagonal(implied, False)

    def weights(idx):
        y = Y[idx]
        w = np.where(y > 0, 1.0, weak).astype(np.float32)
        mask = (y @ implied.astype(np.float32)) > 0
        w[mask & (y == 0)] = 0.0
        w[A[idx]] = 1.0
        return w

    # rare tags seen more often (at most 4x per epoch)
    med = float(np.median([cnt[t] for t in classes]))
    rep = {i: int(min(4, max(1, round(max([math.sqrt(med / cnt[t]) for t in rows[i]["tagset"] if t in ci] or [1]))))) for i in train}

    backbone = env("BACKBONE", "mispeech/ced-base")
    if "dasheng" in backbone:  # same 64-band log-mel front end as CED; encoder takes (B, 1, F, T)
        from transformers import AutoModel

        big = AutoModel.from_pretrained(backbone, trust_remote_code=True)
        enc_fn, width = (lambda m: big.encoder(m.unsqueeze(1))), big.config.encoder_kwargs["embed_dim"]
        enc_mod = big.encoder
    else:
        big = AutoModelForAudioClassification.from_pretrained(backbone, trust_remote_code=True)
        enc_fn, width = (lambda m: big.encoder(m).logits), 768
        enc_mod = big.encoder

    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.enc = enc_mod
            self.head = nn.Linear(width, K)

        def forward(self, m):
            return self.head(enc_fn(m).mean(1))

    net = Net().to(dev)
    mel = T.MelSpectrogram(sample_rate=SR, n_fft=512, win_length=512, hop_length=160, n_mels=64, f_min=0, f_max=8000, center=True).to(dev)
    to_db = T.AmplitudeToDB(top_db=120).to(dev)
    opt = torch.optim.AdamW([{"params": net.enc.parameters(), "lr": float(env("LR", "3e-5"))},
                             {"params": net.head.parameters(), "lr": float(env("HEAD_LR", "1e-3"))}], weight_decay=0.01)
    base_lr = [g["lr"] for g in opt.param_groups]
    amp = dict(device_type="cuda", dtype=torch.bfloat16) if dev == "cuda" else dict(device_type="cpu", dtype=torch.bfloat16, enabled=False)

    def mirror(names):
        """Copy outputs to MIRROR (a mounted private bucket) as they are written, so a killed job keeps its best epoch."""
        if not env("MIRROR"):
            return
        import shutil

        try:
            os.makedirs(env("MIRROR"), exist_ok=True)
            for n in names:
                shutil.copyfile(os.path.join(out, n), os.path.join(env("MIRROR"), n + ".tmp"))
                os.replace(os.path.join(env("MIRROR"), n + ".tmp"), os.path.join(env("MIRROR"), n))
        except Exception as e:  # noqa: BLE001
            log(f"mirror failed: {e}")

    def feats(wav):
        with torch.no_grad():
            return to_db(mel(wav))

    def crop(i, train_mode):
        a = audio[i]
        if a.shape[0] > WIN:
            s = random.randrange(a.shape[0] - WIN + 1) if train_mode else 0
            a = a[s : s + WIN]
        return a

    def epoch_batches():
        items = [i for i in train for _ in range(rep[i])]
        random.shuffle(items)
        by = defaultdict(list)
        for i in items:
            by[bucket_of(min(audio[i].shape[0], WIN))].append(i)
        batches = [v[k : k + B] for v in by.values() for k in range(0, len(v), B)]
        random.shuffle(batches)
        return batches

    def to_wave(idx, train_mode):
        segs = [crop(i, train_mode) for i in idx]
        L = bucket_of(max(s.shape[0] for s in segs)) * SR
        w = np.zeros((len(segs), L), np.float32)
        for k, s in enumerate(segs):
            x = s.astype(np.float32) / 32767
            if train_mode:
                x = x * 10 ** (random.uniform(-6, 6) / 20)
            w[k, : x.shape[0]] = x
        return torch.from_numpy(w).to(dev, non_blocking=True)

    def spec_aug(m):
        Bn, F, Tn = m.shape
        for _ in range(2):
            f = torch.randint(0, 8, (Bn, 1, 1), device=m.device)
            f0 = (torch.rand(Bn, 1, 1, device=m.device) * (F - f)).long()
            fr = torch.arange(F, device=m.device)[None, :, None]
            m = m.masked_fill((fr >= f0) & (fr < f0 + f), 0.0)
            t = torch.randint(0, max(2, Tn // 10), (Bn, 1, 1), device=m.device)
            t0 = (torch.rand(Bn, 1, 1, device=m.device) * (Tn - t).clamp(min=1)).long()
            tr_ = torch.arange(Tn, device=m.device)[None, None, :]
            m = m.masked_fill((tr_ >= t0) & (tr_ < t0 + t), 0.0)
        return m

    @torch.no_grad()
    def predict(idx):
        """Max sigmoid over the clip's 10 s windows (last window aligned to the end), as the app scores a clip."""
        net.eval()
        jobs = []  # (item position, window)
        for p, i in enumerate(idx):
            a = audio[i]
            starts = [0] if a.shape[0] <= WIN else sorted({*range(0, a.shape[0] - WIN + 1, WIN), a.shape[0] - WIN})
            jobs += [(p, a[s : s + WIN]) for s in starts]
        by = defaultdict(list)
        for p, seg in jobs:
            by[bucket_of(seg.shape[0])].append((p, seg))
        P = np.zeros((len(idx), K), np.float32)
        for b, lst in by.items():
            for k in range(0, len(lst), B * 2):
                chunk = lst[k : k + B * 2]
                w = np.zeros((len(chunk), b * SR), np.float32)
                for j, (_, seg) in enumerate(chunk):
                    w[j, : seg.shape[0]] = seg.astype(np.float32) / 32767
                with torch.autocast(**amp):
                    pr = torch.sigmoid(net(feats(torch.from_numpy(w).to(dev))).float()).cpu().numpy()
                for j, (p, _) in enumerate(chunk):
                    P[p] = np.maximum(P[p], pr[j])
        net.train()
        return P

    def ap(y, s):
        if y.sum() == 0:
            return None
        o = np.argsort(-s)
        y = y[o]
        tp = np.cumsum(y)
        return float((tp / np.arange(1, len(y) + 1))[y > 0].mean())

    def pr_at(y, s, th):
        pred = s >= th
        tp = float((pred & (y > 0)).sum())
        return tp / max(pred.sum(), 1), tp / max((y > 0).sum(), 1)

    def best_threshold(y, s):
        """argmax min(P, R) on validation (weak view: unlabelled = negative), >= 5 positives."""
        if y.sum() < 5:
            return None
        o = np.argsort(-s)
        ys, ss = y[o], s[o]
        tp = np.cumsum(ys)
        prec, rec = tp / np.arange(1, len(ys) + 1), tp / ys.sum()
        m = np.minimum(prec, rec)
        k = int(np.argmax(m))
        # precision first (Chris, Oct 11): the lowest cutoff whose validation precision stays >= PREC_FLOOR, i.e. the most
        # recall at that precision; falls back to the balanced cutoff when no cutoff reaches the floor
        ok_ = np.nonzero(prec >= float(env("PREC_FLOOR", "0.5")))[0]
        kp = int(ok_.max()) if ok_.size else k
        return float(ss[k]), float(m[k]), float(ss[kp]), float(prec[kp]), float(rec[kp])

    run = env("TRACKIO_RUN", "ced-base-finetune-r1")
    if charts:
        charts.start(run, {"model": backbone, "classes": K, "train": len(train), "val": len(val), "batch": B,
                           "lr": base_lr[0], "head_lr": base_lr[1], "weak": weak, "max_epochs": max_epochs})

    step, total_steps, warm = 0, None, 300
    epochs = max_epochs
    best = (-1.0, -1)
    hist = []
    net.train()
    if score_only:
        import shutil

        shutil.copyfile(score_only, os.path.join(out, "model.pt"))
        max_epochs = 0
    for ep in range(max_epochs):
        if ep >= epochs:
            break
        batches = epoch_batches()
        if total_steps is None:
            total_steps = len(batches) * epochs
        te = time.time()
        losses = []
        for bi, idx in enumerate(batches):
            frac = min(1.0, step / max(1, total_steps))
            scale = min(1.0, (step + 1) / warm) * 0.5 * (1 + math.cos(math.pi * frac))
            for g, lr in zip(opt.param_groups, base_lr):
                g["lr"] = lr * scale
            m = spec_aug(feats(to_wave(idx, True)))
            y = torch.from_numpy(Y[idx]).to(dev)
            w = torch.from_numpy(weights(idx)).to(dev)
            with torch.autocast(**amp):
                logit = net(m)
            loss = (nn.functional.binary_cross_entropy_with_logits(logit.float(), y, reduction="none") * w).sum() / w.sum().clamp(min=1)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
            step += 1
            losses.append(loss.item())
            if step % 50 == 0:
                log(f"ep {ep + 1} step {bi + 1}/{len(batches)} loss {np.mean(losses[-50:]):.4f}")
                if charts:
                    charts.log({"loss": float(np.mean(losses[-50:])), "lr": opt.param_groups[0]["lr"]}, step=step)
            if mins() > budget - 12:
                log("time budget: stopping training")
                break
        ep_min = (time.time() - te) / 60
        if ep == 0:  # fit the remaining epochs (and the cosine schedule) into the budget
            left = budget - mins() - 12
            epochs = max(1, min(max_epochs, 1 + int(left // (ep_min * 1.08))))
            total_steps = len(batches) * epochs
            log(f"epoch took {ep_min:.1f} min; planning {epochs} epochs")
        Pv = predict(val)
        aps = [a for k in range(K) if (a := ap(Y[val][:, k], Pv[:, k])) is not None]
        vmap = float(np.mean(aps)) if aps else 0.0
        hist.append({"epoch": ep + 1, "loss": float(np.mean(losses)) if losses else None, "val_mAP": vmap, "minutes": ep_min})
        log(f"epoch {ep + 1}: loss {hist[-1]['loss']:.4f} val mAP {vmap:.4f} ({len(aps)} tags)")
        if charts:
            charts.log({"epoch": ep + 1, "epoch loss": hist[-1]["loss"] or 0.0, "validation mAP": vmap, "minutes per epoch": ep_min}, step=step)
        if vmap > best[0]:
            best = (vmap, ep + 1)
            torch.save({k: v.half() for k, v in net.state_dict().items()}, os.path.join(out, "model.pt"))
            mirror(["model.pt"])
        if mins() > budget - 12:
            break

    # score: thresholds from validation, then the held-out test once
    net.load_state_dict({k: v.float() for k, v in torch.load(os.path.join(out, "model.pt")).items()})
    Pv, Pt = predict(val), predict(test)
    Yv, Yt = Y[val], Y[test]
    per_tag, ths = {}, {}
    for k, t in enumerate(classes):
        bt = best_threshold(Yv[:, k], Pv[:, k])
        e = {"train_pos": int(cnt[t]), "val_pos": int(Yv[:, k].sum()), "test_pos": int(Yt[:, k].sum())}
        if bt:
            ths[t] = {"precision_first": bt[2], "balanced": bt[0]}
            e["val_min_pr"] = round(bt[1], 4)
            e["val_precision_first"] = [round(bt[3], 4), round(bt[4], 4)]
            if Yt[:, k].sum() >= 5:
                p, r = pr_at(Yt[:, k], Pt[:, k], bt[2])
                e["test_precision"], e["test_recall"] = round(p, 4), round(r, 4)
                p, r = pr_at(Yt[:, k], Pt[:, k], bt[0])
                e["test_balanced"] = [round(p, 4), round(r, 4)]
        a = ap(Yt[:, k], Pt[:, k])
        if a is not None:
            e["test_ap"] = round(a, 4)
        per_tag[t] = e
    scored = [e for e in per_tag.values() if "test_precision" in e]
    # counts with precision-first cutoffs at each ship line under discussion (50/50, 50/30, 60/30, 60/60, 70/70)
    bars = {f"{int(pb * 100)}/{int(rb * 100)}": int(sum(e["test_precision"] >= pb and e["test_recall"] >= rb for e in scored))
            for pb, rb in ((0.5, 0.5), (0.5, 0.3), (0.6, 0.3), (0.6, 0.6), (0.7, 0.7))}
    report = {"model": f"{backbone} fine-tuned end to end", "run": run, "best_epoch": best[1], "val_mAP": float(best[0]),
              "classes": classes, "train": len(train), "val": len(val), "test": len(test), "test_tags_scored": len(scored),
              "test_bars": bars, "history": hist, "minutes": round(mins(), 1),
              "test_note": "run 9 held-out rows (weak view: unlabelled = negative), thresholds from validation; not the scoreboard's judge sets"}
    json.dump(classes, open(os.path.join(out, "classes.json"), "w"))
    json.dump(ths, open(os.path.join(out, "thresholds.json"), "w"), indent=1)
    json.dump(per_tag, open(os.path.join(out, "per-tag.json"), "w"), indent=1)
    json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
    mirror(["model.pt", "classes.json", "thresholds.json", "per-tag.json", "report.json"])
    log(f"test bars {bars} over {len(scored)} tags; best epoch {best[1]} val mAP {best[0]:.4f}")
    if charts:
        charts.log({"test tags scored": len(scored), **{f"test tags at {k}": v for k, v in bars.items()}}, step=step)
        charts.finish()
    if env("UPLOAD_REPO"):
        from huggingface_hub import HfApi

        for attempt in range(4):
            try:
                HfApi().upload_folder(repo_id=env("UPLOAD_REPO"), folder_path=out, path_in_repo=env("UPLOAD_PATH", "ced-r1"),
                                      commit_message=f"{run}: fine-tuned {backbone}, {K} tags")
                log("uploaded")
                break
            except Exception as e:  # noqa: BLE001
                log(f"upload retry: {e}")
                time.sleep(10 * (attempt + 1))
    log("done")


if __name__ == "__main__":
    main()
