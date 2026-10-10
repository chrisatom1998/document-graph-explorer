# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "torch>=2.3",
#   "torchaudio>=2.3",
#   "transformers>=4.40,<5",
#   "huggingface_hub>=0.25",
#   "pyarrow>=15",
#   "numpy",
#   "av>=12",
#   "soxr",
# ]
# ///
"""Round 11 teacher features: CED-base and CLAP embeddings for training audio.

Two large pretrained listeners describe every clip from its first 10 s:
- CED-base (mispeech/ced-base, Apache 2.0, AudioSet): mean-pooled 768-d embedding + 527 AudioSet probabilities.
- CLAP (laion/larger_clap_music_and_speech, the encoder the app already ships): 512-d audio embedding, computed
  like the app (48 kHz mono, first 10 s, short clips repeat-padded).
Per-tag "teacher" heads are fitted on these features elsewhere; nothing here sees a held-out clip.

MODE=tars   reads <REPO>/<dir>/manifest.csv + audio-*.tar for each dir in DIRS (a private HF dataset, HF_TOKEN).
MODE=bucket reads <SRC>/labels/labels.csv (split=train rows) and the files beside it in a mounted private bucket
            (round 10's commercial training packs, 16 kHz mono); 2,000 rows per output.
MODE=mirror reads the public Freesound mirror benjamin-paine/freesound-laion-640k (CC Sampling+ skipped).
Writes one .npz per tar / parquet shard to OUT (a mounted private bucket): id, seconds, ced_emb, ced_probs, clap
(float16), plus username/license for the mirror. Finished outputs are skipped, so a re-run resumes.
Env: OUT, MODE, REPO, DIRS, PART/PARTS (every PARTS-th input from PART), COUNT (max inputs per part, dry run),
MAX_ROWS (per mirror shard), STOP_AFTER_MIN, BATCH, WORKERS.
ALLOW (MODE=mirror, optional, default off): a CSV with columns file,freesound_id; only those shards and clips are run.
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

MIRROR = "benjamin-paine/freesound-laion-640k"
SAMPLING_PLUS = 5
MAX_S = 10.0
_fe = None


def decode(b):
    """bytes -> (16 kHz first 10 s, CLAP input features from 48 kHz first 10 s, seconds) or None."""
    global _fe
    if not b:
        return None
    try:
        import av
        import soxr

        # PyAV (ffmpeg) rather than libsndfile: the staged FLACs are streamed without a length and can't be seeked
        with av.open(io.BytesIO(b)) as c:
            st = c.streams.audio[0]
            sr = st.rate or 48000
            rs = av.AudioResampler(format="flt", layout="mono", rate=sr)
            out, n = [], 0
            for fr in c.decode(st):
                for g in rs.resample(fr):
                    a = g.to_ndarray().reshape(-1)
                    out.append(a)
                    n += a.size
                if n >= MAX_S * sr:
                    break
            dur = float(st.duration * st.time_base) if st.duration else (c.duration / 1e6 if c.duration else 0.0)
        x = np.concatenate(out)[: int(MAX_S * sr)].astype(np.float32)
        if x.shape[0] < 64:
            return None
        x16 = soxr.resample(x, sr, 16000) if sr != 16000 else x
        if x16.shape[0] < 4000:
            x16 = np.pad(x16, (0, 4000 - x16.shape[0]))
        x48 = soxr.resample(x, sr, 48000) if sr != 48000 else x
        if _fe is None:
            from transformers import ClapFeatureExtractor

            _fe = ClapFeatureExtractor.from_pretrained("laion/larger_clap_music_and_speech")
        n = int(48000 * MAX_S)
        if x48.shape[0] < n:  # repeat-pad to 10 s, as the app does
            x48 = np.tile(x48, int(np.ceil(n / x48.shape[0])))[:n]
        feats = _fe(x48[:n], sampling_rate=48000, return_tensors="np", padding="repeatpad", truncation="rand_trunc")
        return x16.astype(np.float32), feats["input_features"][0].astype(np.float32), float(dur or (x.shape[0] / sr))
    except Exception:
        return None


def inputs_tars(repo, dirs):
    from huggingface_hub import HfApi

    files = HfApi().list_repo_files(repo, repo_type="dataset")
    out = []
    for d in dirs:
        out += sorted(f for f in files if f.startswith(d.rstrip("/") + "/") and f.endswith(".tar"))
    return out


def items_tar(path, prefix):
    """Yield (id, bytes, extra) for every member of a tar, ids from the dir's manifest."""
    with tarfile.open(path, "r|*") as t:
        for m in t:
            if not m.isfile():
                continue
            yield prefix + m.name, t.extractfile(m).read(), {}


def main():
    import torch
    import torchaudio.transforms as T
    from huggingface_hub import HfApi, hf_hub_download
    from transformers import AutoModelForAudioClassification, ClapModel

    out = os.environ["OUT"]
    os.makedirs(out, exist_ok=True)
    mode = os.environ.get("MODE", "tars")
    allow = None
    part, parts = int(os.environ.get("PART", "0")), int(os.environ.get("PARTS", "1"))
    count = int(os.environ.get("COUNT", "0") or 0)
    max_rows = int(os.environ.get("MAX_ROWS", "0") or 0)
    stop_after = float(os.environ.get("STOP_AFTER_MIN", "0") or 0) * 60
    batch = int(os.environ.get("BATCH", "64"))
    workers = int(os.environ.get("WORKERS", str(os.cpu_count() or 4)))
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"mode={mode} device={dev} workers={workers}", flush=True)

    if mode == "tars":
        repo = os.environ["REPO"]
        dirs = os.environ["DIRS"].split(",")
        files = inputs_tars(repo, dirs)
        # manifests (labels stay in the private repo; copy them next to the features for the head fit)
        for d in dirs:
            p = hf_hub_download(repo, d.rstrip("/") + "/manifest.csv", repo_type="dataset", cache_dir="/tmp/hfcache")
            dst = os.path.join(out, "manifests", d.strip("/").replace("/", "__") + ".csv")
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(p, "rb") as a, open(dst, "wb") as b:
                b.write(a.read())
    elif mode == "bucket":
        src = os.environ["SRC"]
        rows_all = [r for r in csv.DictReader(open(os.path.join(src, "labels", "labels.csv"), newline="", encoding="utf-8"))
                    if r.get("split") == "train"]
        mdst = os.path.join(out, "manifests", "commercial.csv")
        os.makedirs(os.path.dirname(mdst), exist_ok=True)
        with open(mdst, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["id", "group", "split", "tags", "absent", "file"])
            for r in rows_all:
                w.writerow([r["path"], f"{r['source']}:{r['group']}", "train", r["present_tags"].replace(";", "|"),
                            r["absent_tags"].replace(";", "|"), r["path"]])
        files = [f"commercial/chunk-{i // 2000:04d}" for i in range(0, len(rows_all), 2000)]
    else:
        repo = MIRROR
        files = sorted(f for f in HfApi().list_repo_files(repo, repo_type="dataset") if f.endswith(".parquet"))
        files = [f for f in files if "/test-" in f] + [f for f in files if "/train-" in f]
        if os.environ.get("ALLOW"):  # opt-in allowlist: shard file -> Freesound ids to run
            allow = {}
            for r in csv.DictReader(open(os.environ["ALLOW"], newline="")):
                allow.setdefault(r["file"], set()).add(int(r["freesound_id"]))
            files = [f for f in files if f in allow]
            print(f"allowlist: {sum(map(len, allow.values()))} clips in {len(files)} shards", flush=True)
    files = files[part::parts]
    if count:
        files = files[:count]
    key = lambda f: f.replace("/", "__").rsplit(".", 1)[0] + ".npz"  # noqa: E731
    todo = [f for f in files if not os.path.exists(os.path.join(out, key(f)))]
    print(f"{len(files)} inputs in slice, {len(todo)} to do", flush=True)

    ced = AutoModelForAudioClassification.from_pretrained("mispeech/ced-base", trust_remote_code=True).to(dev).eval()
    with open(os.path.join(out, "ced-labels.txt"), "w") as fh:
        fh.write("\n".join(ced.config.id2label[i] for i in range(len(ced.config.id2label))) + "\n")
    mel = T.MelSpectrogram(sample_rate=16000, n_fft=512, win_length=512, hop_length=160, n_mels=64, center=True).to(dev)
    to_db = T.AmplitudeToDB(top_db=120).to(dev)
    clap = ClapModel.from_pretrained("laion/larger_clap_music_and_speech").to(dev).eval()

    q: "queue.Queue" = queue.Queue(maxsize=2)

    def fetch():
        for f in todo:
            for attempt in range(5):
                try:
                    p = hf_hub_download(repo, f, repo_type="dataset", cache_dir="/tmp/hfcache")
                    break
                except Exception as e:  # noqa: BLE001
                    print(f"download retry {f}: {e}", flush=True)
                    time.sleep(5 * (attempt + 1))
            else:
                print(f"download FAILED {f}", flush=True)
                continue
            q.put((f, p))
        q.put(None)

    if mode == "bucket":
        def fetch():  # noqa: F811
            for f in todo:
                q.put((f, None))
            q.put(None)

    threading.Thread(target=fetch, daemon=True).start()
    pool = ProcessPoolExecutor(workers)
    t0 = time.time()

    @torch.no_grad()
    def embed(x16s, cfs):
        L = max(x.shape[0] for x in x16s)
        w = torch.zeros(len(x16s), L)
        for i, x in enumerate(x16s):
            w[i, : x.shape[0]] = torch.from_numpy(x)
        m = to_db(mel(w.to(dev)))
        o = ced(m)
        e = o.hidden_states.mean(1)
        c = clap.get_audio_features(input_features=torch.from_numpy(np.stack(cfs)).to(dev))
        return e.half().cpu().numpy(), o.logits.half().cpu().numpy(), c.half().cpu().numpy()

    while True:
        it = q.get()
        if it is None:
            break
        f, path = it
        if stop_after and time.time() - t0 > stop_after:
            print("stop: time budget reached", flush=True)
            break
        ts = time.time()
        rows = []  # (id, bytes, extra)
        if mode == "tars":
            prefix = f.split("/")[-2] + "/" + os.path.basename(f) + "/"
            rows = list(items_tar(path, prefix))
        elif mode == "bucket":
            k = int(f.rsplit("-", 1)[1])
            for r in rows_all[k * 2000 : (k + 1) * 2000]:
                try:
                    with open(os.path.join(src, r["path"]), "rb") as fh:
                        rows.append(("commercial/" + r["path"], fh.read(), {}))
                except OSError as e:
                    print(f"read failed {r['path']}: {e}", flush=True)
        else:
            import pyarrow.parquet as pq

            pf = pq.ParquetFile(path)
            for rg in range(pf.num_row_groups):
                tab = pf.read_row_group(rg, columns=["audio", "username", "freesound_id", "license"])
                a, u, i_, lc = (tab.column(c).to_pylist() for c in ("audio", "username", "freesound_id", "license"))
                for k in range(tab.num_rows):
                    if lc[k] != SAMPLING_PLUS and a[k] and (allow is None or int(i_[k]) in allow[f]):
                        rows.append((str(i_[k]), a[k]["bytes"], {"username": u[k], "license": lc[k]}))
                if max_rows and len(rows) >= max_rows:
                    rows = rows[:max_rows]
                    break
        res = {"id": [], "seconds": [], "ced_emb": [], "ced_probs": [], "clap": [], "username": [], "license": []}
        nfail = 0
        for s in range(0, len(rows), batch * 4):
            chunk = rows[s : s + batch * 4]
            dec = list(pool.map(decode, [r[1] for r in chunk], chunksize=4))
            good = [(r, d) for r, d in zip(chunk, dec) if d is not None]
            nfail += len(chunk) - len(good)
            for b in range(0, len(good), batch):
                g = good[b : b + batch]
                e, p, c = embed([d[0] for _, d in g], [d[1] for _, d in g])
                res["ced_emb"].append(e)
                res["ced_probs"].append(p)
                res["clap"].append(c)
                for r, d in g:
                    res["id"].append(r[0])
                    res["seconds"].append(d[2])
                    res["username"].append(r[2].get("username", ""))
                    res["license"].append(r[2].get("license", -1))
        if res["id"]:
            tmp = os.path.join(out, key(f) + ".tmp.npz")
            np.savez(
                tmp,
                id=np.array(res["id"]),
                seconds=np.array(res["seconds"], dtype=np.float32),
                ced_emb=np.concatenate(res["ced_emb"]),
                ced_probs=np.concatenate(res["ced_probs"]),
                clap=np.concatenate(res["clap"]),
                username=np.array(res["username"]),
                license=np.array(res["license"], dtype=np.int8),
            )
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
