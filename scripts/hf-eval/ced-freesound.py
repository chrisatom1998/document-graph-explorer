# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "torch>=2.3",
#   "torchaudio>=2.3",
#   "transformers>=4.40,<5",
#   "huggingface_hub>=0.25",
#   "pyarrow>=15",
#   "numpy",
#   "soundfile>=0.12",
#   "soxr",
# ]
# ///
"""Score every clip of the HF Freesound mirror with CED-base (AudioSet, Apache 2.0).

Writes one .npz per parquet shard to OUT (a mounted private bucket): freesound_id,
username, license, seconds, and all 527 AudioSet probabilities (float16) from the
first 10 s of each clip. CC Sampling+ clips are skipped. Shards already written are
skipped, so a re-run resumes.

Run by tasks/ced-freesound.sh on HF Jobs. Env: OUT, PART/PARTS (every PARTS-th shard from PART), COUNT (max
shards per part, for a dry run), MAX_ROWS (per shard), STOP_AFTER_MIN (stop starting new shards after this many
minutes so job.sh can still upload what is done), BATCH, WORKERS, DEVICE.
"""
import io
import os
import queue
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

REPO = "benjamin-paine/freesound-laion-640k"
SR = 16000
MAX_S = 10.0
SAMPLING_PLUS = 5  # ClassLabel index of CC-Sampling+


def decode(item):
    b = item
    if not b:
        return None, 0.0
    try:
        import soundfile as sf
        import soxr

        with sf.SoundFile(io.BytesIO(b)) as f:
            sr = f.samplerate
            dur = f.frames / sr if f.frames > 0 else 0.0
            x = f.read(frames=int(MAX_S * sr), dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        if sr != SR:
            x = soxr.resample(x, sr, SR)
        if x.shape[0] < SR // 4:
            x = np.pad(x, (0, SR // 4 - x.shape[0]))
        return x.astype(np.float32), float(dur)
    except Exception:
        return None, 0.0


def main():
    import pyarrow.parquet as pq
    import torch
    import torchaudio.transforms as T
    from huggingface_hub import HfApi, hf_hub_download
    from transformers import AutoModelForAudioClassification

    out = os.environ["OUT"]
    os.makedirs(out, exist_ok=True)
    part = int(os.environ.get("PART", "0"))
    parts = int(os.environ.get("PARTS", "1"))
    count = int(os.environ.get("COUNT", "0") or 0)
    stop_after = float(os.environ.get("STOP_AFTER_MIN", "0") or 0) * 60
    max_rows = int(os.environ.get("MAX_ROWS", "0"))
    batch = int(os.environ.get("BATCH", "64"))
    workers = int(os.environ.get("WORKERS", str(os.cpu_count() or 4)))
    device = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
    print(f"device={device} workers={workers} cpus={os.cpu_count()}", flush=True)

    files = sorted(f for f in HfApi().list_repo_files(REPO, repo_type="dataset") if f.endswith(".parquet"))
    # test split first (smaller, 123 shards), then train
    files = [f for f in files if "/test-" in f] + [f for f in files if "/train-" in f]
    files = files[part::parts]
    if count:
        files = files[:count]
    todo = [f for f in files if not os.path.exists(os.path.join(out, os.path.basename(f).replace(".parquet", ".npz")))]
    print(f"{len(files)} shards in slice, {len(todo)} to do", flush=True)

    model = AutoModelForAudioClassification.from_pretrained("mispeech/ced-base", trust_remote_code=True).to(device).eval()
    labels = [model.config.id2label[i] for i in range(len(model.config.id2label))]
    with open(os.path.join(out, "labels.txt"), "w") as fh:
        fh.write("\n".join(labels) + "\n")
    mel = T.MelSpectrogram(sample_rate=SR, n_fft=512, win_length=512, hop_length=160, n_mels=64, f_min=0, f_max=None, center=True).to(device)
    to_db = T.AmplitudeToDB(top_db=120).to(device)

    q: "queue.Queue[tuple[str, str] | None]" = queue.Queue(maxsize=2)

    def fetch():
        for f in todo:
            t = time.time()
            for attempt in range(5):
                try:
                    p = hf_hub_download(REPO, f, repo_type="dataset", cache_dir="/tmp/hfcache")
                    break
                except Exception as e:  # noqa: BLE001
                    print(f"download retry {f}: {e}", flush=True)
                    time.sleep(5 * (attempt + 1))
            else:
                print(f"download FAILED {f}", flush=True)
                continue
            print(f"downloaded {f} in {time.time() - t:.0f}s", flush=True)
            q.put((f, p))
        q.put(None)

    threading.Thread(target=fetch, daemon=True).start()
    pool = ProcessPoolExecutor(workers)
    t0 = time.time()
    total = 0
    while True:
        item = q.get()
        if item is None:
            break
        f, path = item
        if stop_after and time.time() - t0 > stop_after:
            print(f"stop: {stop_after / 60:.0f} min reached, leaving the rest of the shards", flush=True)
            break
        ts = time.time()
        pf = pq.ParquetFile(path)
        ids, users, lic, secs, probs = [], [], [], [], []
        nfail = 0
        nrows = 0
        for rg in range(pf.num_row_groups):
            tab = pf.read_row_group(rg, columns=["audio", "username", "freesound_id", "license"])
            n = tab.num_rows
            if max_rows and nrows >= max_rows:
                break
            if max_rows:
                tab = tab.slice(0, max_rows - nrows)
                n = tab.num_rows
            nrows += n
            lc = tab.column("license").to_pylist()
            keep = [i for i in range(n) if lc[i] != SAMPLING_PLUS]
            audio = tab.column("audio").to_pylist()
            bytes_ = [audio[i]["bytes"] if audio[i] else None for i in keep]
            uid = tab.column("freesound_id").to_pylist()
            un = tab.column("username").to_pylist()
            dec = list(pool.map(decode, bytes_, chunksize=8))
            good = [(keep[j], x, d) for j, (x, d) in enumerate(dec) if x is not None]
            nfail += len(keep) - len(good)
            good.sort(key=lambda g: g[1].shape[0])
            for b0 in range(0, len(good), batch):
                chunk = good[b0:b0 + batch]
                L = max(g[1].shape[0] for g in chunk)
                xb = np.zeros((len(chunk), L), np.float32)
                for k, g in enumerate(chunk):
                    xb[k, : g[1].shape[0]] = g[1]
                with torch.no_grad(), torch.autocast(device_type="cuda", dtype=torch.float16, enabled=device == "cuda"):
                    xt = torch.from_numpy(xb).to(device)
                    m = to_db(mel(xt).unsqueeze(1)).squeeze(1)  # per-clip top_db, as the extractor does one clip at a time
                    p = model(input_values=m.float()).logits.float().cpu().numpy()
                for k, g in enumerate(chunk):
                    i = g[0]
                    ids.append(uid[i]); users.append(un[i]); lic.append(lc[i]); secs.append(g[2])
                probs.append(p.astype(np.float16))
        P = np.concatenate(probs) if probs else np.zeros((0, len(labels)), np.float16)
        name = os.path.basename(f).replace(".parquet", ".npz")
        tmp = os.path.join("/tmp", name)
        np.savez_compressed(tmp, freesound_id=np.array(ids, np.uint64), username=np.array(users, dtype=object).astype(str),
                            license=np.array(lic, np.int8), seconds=np.array(secs, np.float32), probs=P)
        with open(tmp, "rb") as src, open(os.path.join(out, name + ".part"), "wb") as dst:
            dst.write(src.read())
        os.replace(os.path.join(out, name + ".part"), os.path.join(out, name))
        os.remove(tmp)
        try:
            os.remove(os.path.realpath(path))
        except OSError:
            pass
        total += len(ids)
        el = time.time() - t0
        print(f"{f}: rows {nrows}, scored {len(ids)}, failed {nfail}, {time.time() - ts:.0f}s; total {total} in {el / 60:.1f} min ({total / max(el, 1):.0f}/s)", flush=True)
    print("DONE", total, flush=True)


if __name__ == "__main__":
    sys.exit(main())
