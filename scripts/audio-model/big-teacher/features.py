# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "torch>=2.3",
#   "torchaudio>=2.3",
#   "transformers>=4.40,<5",
#   "huggingface_hub>=0.25,<1",
#   "numpy",
#   "av>=12",
#   "soxr",
#   "einops",
#   "nnAudio",
# ]
# ///
"""Bigger teacher probe: Dasheng-0.6B and MERT-v1-330M features, for a stronger round 11-style teacher.

Round 11's teacher (an MLP over frozen CED-base features, 86M parameters) won bass guitar and machine ambience through
distillation. This describes the same clips with two larger pretrained listeners, so a teacher fit on them can be
compared tag by tag with the CED teacher on the same held-out clips:
- Dasheng-0.6B (mispeech/dasheng-0.6B, Apache 2.0, 630M, general audio): mean and max of the last layer plus the mean
  of layer 16, from 16 kHz mono (3,840 numbers).
- MERT-v1-330M (m-a-p/MERT-v1-330M, CC BY-NC 4.0, 315M, music): time means of layers 6, 12, 18 and 24 from 24 kHz
  mono (4,096 numbers).
Each clip is described alone (no padding), so the cloud (GPU) and container (CPU) features match.

MODE=tars / MODE=bucket: training audio on a Hugging Face Jobs GPU, first 10 s of each clip, exactly the inputs and
ids of round11/teacher-features.py (REPO, DIRS / SRC, PART, PARTS, STOP_AFTER_MIN; OUT is a mounted private bucket).
Writes one .npz per tar / 2,000-row chunk: id, seconds, das, mert (float16). Finished outputs are skipped.
MODE=local: HELD-OUT clips, run only in the project container (judge audio never leaves it). LIST is a text file of
audio paths; writes OUT (one .npz) with path, win, ced_emb, ced_probs, das, mert for every 10 s window (at most MAX_WIN, default 3).
"""
import csv
import io
import os
import queue
import tarfile
import threading
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

MAX_S = 10.0
DAS, MERT, CED = "mispeech/dasheng-0.6B", "m-a-p/MERT-v1-330M", "mispeech/ced-base"
MERT_LAYERS = (6, 12, 18, 24)
DAS_MID = 15  # 0-based block index: output of block 16 of 32


def load_audio(b, max_s):
    """bytes or path -> (mono float32 at its own rate, rate, seconds) or None."""
    import av

    try:
        with av.open(io.BytesIO(b) if isinstance(b, (bytes, bytearray)) else b) as c:
            st = c.streams.audio[0]
            sr = st.rate or 48000
            rs = av.AudioResampler(format="flt", layout="mono", rate=sr)
            out, n = [], 0
            for fr in c.decode(st):
                for g in rs.resample(fr):
                    a = g.to_ndarray().reshape(-1)
                    out.append(a)
                    n += a.size
                if max_s and n >= max_s * sr:
                    break
            dur = float(st.duration * st.time_base) if st.duration else (c.duration / 1e6 if c.duration else 0.0)
        x = np.concatenate(out).astype(np.float32)
        if max_s:
            x = x[: int(max_s * sr)]
        if x.shape[0] < 64:
            return None
        return x, sr, float(dur or (x.shape[0] / sr))
    except Exception:
        return None


def rates(x, sr):
    """Window at its own rate -> (16 kHz, 24 kHz), padded to 0.25 s like round 11."""
    import soxr

    x16 = soxr.resample(x, sr, 16000) if sr != 16000 else x
    x24 = soxr.resample(x, sr, 24000) if sr != 24000 else x
    if x16.shape[0] < 4000:
        x16 = np.pad(x16, (0, 4000 - x16.shape[0]))
    if x24.shape[0] < 6000:
        x24 = np.pad(x24, (0, 6000 - x24.shape[0]))
    return x16.astype(np.float32), x24.astype(np.float32)


def decode(b):
    """Training clip bytes -> (16 kHz, 24 kHz first 10 s, seconds) or None."""
    r = load_audio(b, MAX_S)
    if r is None:
        return None
    x, sr, dur = r
    x16, x24 = rates(x, sr)
    return x16, x24, dur


class Encoders:
    def __init__(self, dev, ced=False):
        import torch
        import torchaudio.transforms as T
        from transformers import AutoFeatureExtractor, AutoModel, AutoModelForAudioClassification

        self.torch, self.dev = torch, dev
        self.das = AutoModel.from_pretrained(DAS, trust_remote_code=True).to(dev).eval()
        self.das_fe = AutoFeatureExtractor.from_pretrained(DAS, trust_remote_code=True)
        self.mert = AutoModel.from_pretrained(MERT, trust_remote_code=True).to(dev).eval()
        self._mid = None
        self.das.encoder.blocks[DAS_MID].register_forward_hook(lambda m, i, o: setattr(self, "_mid", o))
        self.ced = None
        if ced:  # held-out side only: the training-side CED features already exist (round 11)
            self.ced = AutoModelForAudioClassification.from_pretrained(CED, trust_remote_code=True).to(dev).eval()
            self.mel = T.MelSpectrogram(sample_rate=16000, n_fft=512, win_length=512, hop_length=160, n_mels=64, center=True).to(dev)
            self.to_db = T.AmplitudeToDB(top_db=120).to(dev)

    def __call__(self, x16, x24):
        """One window -> dict of float16 vectors."""
        torch = self.torch
        with torch.no_grad():
            iv = self.das_fe(x16, sampling_rate=16000, return_tensors="pt")["input_values"].to(self.dev)
            h = self.das(iv).hidden_states[0]
            das = torch.cat([h.mean(0), h.max(0).values, self._mid[0].mean(0)])
            hs = self.mert(torch.from_numpy(x24)[None].to(self.dev), output_hidden_states=True).hidden_states
            mert = torch.cat([hs[k][0].mean(0) for k in MERT_LAYERS])
            out = {"das": das.half().cpu().numpy(), "mert": mert.half().cpu().numpy()}
            if self.ced is not None:
                o = self.ced(self.to_db(self.mel(torch.from_numpy(x16)[None].to(self.dev))))
                out["ced_emb"] = o.hidden_states.mean(1)[0].half().cpu().numpy()
                out["ced_probs"] = o.logits[0].half().cpu().numpy()
        return out


def local(out, lst):
    """Held-out clips, in this container only."""
    import torch

    torch.set_num_threads(int(os.environ.get("THREADS", str(os.cpu_count() or 4))))
    enc = Encoders("cpu", ced=True)
    max_win = int(os.environ.get("MAX_WIN", "3"))
    paths = [l.strip() for l in open(lst, encoding="utf-8") if l.strip()]
    res = {k: [] for k in ("path", "win", "ced_emb", "ced_probs", "das", "mert")}
    t0 = time.time()
    for n, p in enumerate(paths):
        r = load_audio(p, MAX_S * max_win)
        if r is None:
            print(f"decode failed: {p}", flush=True)
            continue
        x, sr, _ = r
        w = int(MAX_S * sr)
        for k in range(0, max(1, int(np.ceil(x.shape[0] / w)))):
            seg = x[k * w : (k + 1) * w]
            if k and seg.shape[0] < sr:  # a tail under 1 s is not its own window
                break
            f = enc(*rates(seg, sr))
            res["path"].append(p); res["win"].append(k)
            for kk, v in f.items():
                res[kk].append(v)
        if n % 100 == 0:
            print(f"{n}/{len(paths)} clips, {time.time() - t0:.0f}s", flush=True)
    np.savez(out, path=np.array(res["path"]), win=np.array(res["win"], dtype=np.int16),
             **{k: np.stack(res[k]) for k in ("ced_emb", "ced_probs", "das", "mert")})
    print(f"done: {len(paths)} clips, {len(res['path'])} windows -> {out}", flush=True)


def main():
    import torch
    from huggingface_hub import hf_hub_download

    out = os.environ["OUT"]
    mode = os.environ.get("MODE", "tars")
    if mode == "local":
        return local(out, os.environ["LIST"])
    os.makedirs(out, exist_ok=True)
    part, parts = int(os.environ.get("PART", "0")), int(os.environ.get("PARTS", "1"))
    stop_after = float(os.environ.get("STOP_AFTER_MIN", "0") or 0) * 60
    workers = int(os.environ.get("WORKERS", str(os.cpu_count() or 4)))
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.backends.cuda.matmul.allow_tf32 = False  # full fp32, to match the container's CPU features
    torch.backends.cudnn.allow_tf32 = False
    print(f"mode={mode} device={dev} workers={workers}", flush=True)

    if mode == "tars":  # same inputs and ids as round11/teacher-features.py
        from huggingface_hub import HfApi

        repo = os.environ["REPO"]
        dirs = os.environ["DIRS"].split(",")
        allf = HfApi().list_repo_files(repo, repo_type="dataset")
        files = []
        for d in dirs:
            files += sorted(f for f in allf if f.startswith(d.rstrip("/") + "/") and f.endswith(".tar"))
    else:
        src = os.environ["SRC"]
        rows_all = [r for r in csv.DictReader(open(os.path.join(src, "labels", "labels.csv"), newline="", encoding="utf-8"))
                    if r.get("split") == "train"]
        files = [f"commercial/chunk-{i // 2000:04d}" for i in range(0, len(rows_all), 2000)]
    files = files[part::parts]
    key = lambda f: f.replace("/", "__").rsplit(".", 1)[0] + ".npz"  # noqa: E731
    todo = [f for f in files if not os.path.exists(os.path.join(out, key(f)))]
    print(f"{len(files)} inputs in slice, {len(todo)} to do", flush=True)

    enc = Encoders(dev)
    q: "queue.Queue" = queue.Queue(maxsize=2)

    def fetch():
        for f in todo:
            if mode != "tars":
                q.put((f, None)); continue
            for attempt in range(5):
                try:
                    q.put((f, hf_hub_download(repo, f, repo_type="dataset", cache_dir="/tmp/hfcache")))
                    break
                except Exception as e:  # noqa: BLE001
                    print(f"download retry {f}: {e}", flush=True)
                    time.sleep(5 * (attempt + 1))
            else:
                print(f"download FAILED {f}", flush=True)
        q.put(None)

    threading.Thread(target=fetch, daemon=True).start()
    pool = ProcessPoolExecutor(workers)
    t0 = time.time()
    while True:
        it = q.get()
        if it is None:
            break
        f, path = it
        if stop_after and time.time() - t0 > stop_after:
            print("stop: time budget reached", flush=True)
            break
        ts = time.time()
        rows = []
        if mode == "tars":
            prefix = f.split("/")[-2] + "/" + os.path.basename(f) + "/"
            with tarfile.open(path, "r|*") as t:
                for m in t:
                    if m.isfile():
                        rows.append((prefix + m.name, t.extractfile(m).read()))
        else:
            k = int(f.rsplit("-", 1)[1])
            for r in rows_all[k * 2000 : (k + 1) * 2000]:
                try:
                    with open(os.path.join(src, r["path"]), "rb") as fh:
                        rows.append(("commercial/" + r["path"], fh.read()))
                except OSError as e:
                    print(f"read failed {r['path']}: {e}", flush=True)
        res = {"id": [], "seconds": [], "das": [], "mert": []}
        nfail = 0
        for s in range(0, len(rows), 256):
            chunk = rows[s : s + 256]
            for (cid, _), d in zip(chunk, pool.map(decode, [r[1] for r in chunk], chunksize=4)):
                if d is None:
                    nfail += 1; continue
                e = enc(d[0], d[1])
                res["id"].append(cid); res["seconds"].append(d[2]); res["das"].append(e["das"]); res["mert"].append(e["mert"])
        if res["id"]:
            tmp = os.path.join(out, key(f) + ".tmp.npz")
            np.savez(tmp, id=np.array(res["id"]), seconds=np.array(res["seconds"], dtype=np.float32),
                     das=np.stack(res["das"]), mert=np.stack(res["mert"]))
            os.replace(tmp, os.path.join(out, key(f)))
        print(f"{f}: {len(res['id'])} clips, {nfail} failed, {time.time() - ts:.0f}s (total {time.time() - t0:.0f}s)", flush=True)
        try:
            if path:
                os.remove(path)
        except OSError:
            pass
    print("done", flush=True)


if __name__ == "__main__":
    main()
