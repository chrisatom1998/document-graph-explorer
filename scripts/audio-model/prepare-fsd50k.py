"""FSD50K (CC-BY; human-labelled Freesound clips) as tagger training windows (dev split) and judging clips (eval split).

Usage: python3 scripts/audio-model/prepare-fsd50k.py <out-dir> [--workers 32] [--limit N]

Fetches the clips from the Hugging Face copy (datasets/Fhrozen/FSD50k, pinned below), one file at a time, and decodes
each to 32 kHz mono. FSD50K lists every class heard in a clip, so a catalog label (labelmap.FSD50K) is present when any
of its classes is and absent otherwise. Skipped everywhere: every Freesound id and uploader the short-clip test set
reserves and every uploader the synth-clip test set reserves (docs/evaluations/*/reserved-test-families.json, plus
its uploader rule), so those tests stay unseen.
  -> fsd50k-mel.npy + fsd50k.json   dev clips, first 10 s as 1000 log-mel frames; FSD50K's own val split (whole
                                    uploaders) is the validation set (train.py honours the item's `val`)
  -> eval-fsd50k.npy + .json        eval clips, up to 30 s, as one flat int16 array with offsets: judging only
"""
import argparse, csv, hashlib, json, os, subprocess, sys, time, warnings
from concurrent.futures import ThreadPoolExecutor
import numpy as np
warnings.filterwarnings('ignore')
import torch
from huggingface_hub import hf_hub_download
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import FSD50K  # noqa: E402
sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
from models.preprocess import AugmentMelSTFT  # noqa: E402

REPO, REV = 'Fhrozen/FSD50k', os.environ.get('FSD50K_REV', 'main')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
CAT = sorted({l for v in FSD50K.values() for l in v})
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def get(path):
    for attempt in range(8):   # the Hub rate-limits file resolves (HTTP 429); back off and retry
        try: return hf_hub_download(REPO, path, repo_type='dataset', revision=REV)
        except Exception as e:
            if attempt == 7: raise
            print(f'{path}: {type(e).__name__}, retry {attempt + 1}', flush=True); time.sleep(min(300, 15 * 2 ** attempt))

def decode(split, fname, seconds):
    # Identical clips share one Hub cache blob, so a sibling may have just deleted it, and a download can arrive damaged:
    # fetch again once, then skip the clip (None) rather than lose hours of prep to one file.
    for attempt in range(2):
        try:
            p = get(f'clips/{split}/{fname}.wav') if attempt == 0 else hf_hub_download(REPO, f'clips/{split}/{fname}.wav', repo_type='dataset', revision=REV, force_download=True)
            pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', p, '-t', str(seconds), '-ac', '1', '-ar', '32000', '-f', 's16le', 'pipe:1'],
                                 capture_output=True, check=True).stdout
        except Exception as e:
            print(f'{split}/{fname}: {type(e).__name__}' + (', fetching again' if attempt == 0 else ', skipped'), flush=True)
            continue
        try: os.remove(os.path.realpath(p))   # keep the disk for the log-mels, not the 44.1 kHz originals
        except OSError: pass
        return np.frombuffer(pcm, np.int16)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--workers', type=int, default=32); ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    a = json.load(open(os.path.join(ROOT, 'docs/evaluations/short-clips-2026-10-04/reserved-test-families.json')))
    b = json.load(open(os.path.join(ROOT, 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json')))
    bad_ids, bad_up = set(a['freesoundIds']), set(a['freesoundUploaders']) | {u.split(':', 1)[1] for u in b['fsdUploaders']}
    reserved = lambda fname, up: fname in bad_ids or up in bad_up or int(h('synth-fresh-up', f'freesound-user:{up}')[:8], 16) % 5 == 0
    mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()

    def labels(r):
        present = {l for c in r['labels'].split(',') for l in FSD50K.get(c, [])}
        return {f'cat:{l}': l in present for l in CAT}

    for split in ('dev', 'eval'):
        info = json.load(open(get(f'metadata/{split}_clips_info_FSD50K.json')))
        rows = list(csv.DictReader(open(get(f'labels/{split}.csv'))))
        kept = [r for r in rows if not reserved(r['fname'], info.get(r['fname'], {}).get('uploader', ''))][:args.limit or None]
        print(f'FSD50K {split}: {len(rows)} clips, {len(rows) - len(kept) if not args.limit else "?"} reserved by other test sets skipped', flush=True)
        seconds = 10 if split == 'dev' else 30
        with ThreadPoolExecutor(args.workers) as pool:
            wavs = pool.map(lambda r: decode(split, r['fname'], seconds), kept)
            if split == 'dev':
                out = np.lib.format.open_memmap(os.path.join(args.out, 'fsd50k-mel.npy'), mode='w+', dtype=np.float16, shape=(len(kept), 128, 1000))
                batch, items = [], []
                def flush():
                    with torch.no_grad(): m = mel(torch.from_numpy(np.stack([x for _, x in batch]).astype(np.float32) / 32768))[:, :, :1000].numpy()
                    for (i, _), v in zip(batch, m): out[i] = v
                    batch.clear()
                i = -1
                for r, x in zip(kept, wavs):
                    if x is None: continue
                    i += 1
                    batch.append((i, np.pad(x[:320000], (0, 320000 - min(len(x), 320000)))))
                    up = info.get(r['fname'], {}).get('uploader', r['fname'])
                    items.append({'id': f"fsd50k:{r['fname']}", 'artist': f'freesound-user:{up}', 'row': i, 'val': r['split'] == 'val',
                                  'labels': {k: float(v) for k, v in labels(r).items()}})
                    if len(batch) == 64: flush()
                    if i % 2000 == 0: print(f'  dev {i}/{len(kept)}', flush=True)
                if batch: flush()
                out.flush(); del out
                json.dump({'source': f'hf://datasets/{REPO}@{REV}', 'items': items}, open(os.path.join(args.out, 'fsd50k.json'), 'w'))
                pos = {c: sum(it['labels'][c] for it in items) for c in items[0]['labels']} if items else {}
                print(f'dev: {len(items)} windows; positives ' + ', '.join(f'{k[4:]} {int(v)}' for k, v in sorted(pos.items(), key=lambda kv: kv[1])), flush=True)
            else:
                chunks, offsets, items, n = [], [0], [], 0
                for i, (r, x) in enumerate((r, x) for r, x in zip(kept, wavs) if x is not None):
                    chunks.append(x); n += len(x); offsets.append(n)
                    items.append({'id': f"fsd50k:{r['fname']}", 'artist': info.get(r['fname'], {}).get('uploader', ''),
                                  'labels': {k: 'present' if v else 'absent' for k, v in labels(r).items()}})
                    if i % 2000 == 0: print(f'  eval {i}/{len(kept)}', flush=True)
                np.save(os.path.join(args.out, 'eval-fsd50k.npy'), np.concatenate(chunks))
                json.dump({'source': f'hf://datasets/{REPO}@{REV}', 'offsets': offsets, 'items': items}, open(os.path.join(args.out, 'eval-fsd50k.json'), 'w'))
                print(f'eval: {len(items)} clips, {n / 32000 / 3600:.1f} h', flush=True)

if __name__ == '__main__':
    main()
