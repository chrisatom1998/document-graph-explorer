"""Freesound sounds for the app tags no other dataset teaches (labelmap.FREESOUND), as tagger training windows and a
held-out test.

Usage: python3 scripts/audio-model/prepare-freesound.py <out-dir> [--per-label 400] [--per-uploader 4] [--limit N]

Picks sounds from the public Freesound metadata dump (datasets/Chr0my/freesound.org) whose uploader tags (or, for
multi-word terms, title) name a target tag, using the catalog's aliases and the sample-library labeller's extra terms.
At most --per-uploader sounds per uploader per tag, chosen by a fixed hash, so no prolific uploader defines a tag.
A sound carries every target tag its text names; the other targets are weak absences (uploaders tag selectively).
Never picks a sound or uploader the short-clip or synth-clip test sets reserve (lists and the synth-clip uploader rule), or a sound in FSD50K eval (a judging
set here). Audio is the public preview MP3 (first ~15 s), read via each uploader's numeric id from one sound page.
One uploader in ten (by hash) is held out entirely as the test set:
  -> freesound-mel.npy + freesound.json   training windows (first 10 s as 1000 log-mel frames)
  -> eval-freesound.npy + .json           the held-out uploaders' sounds, 10 s int16: judging only
Freesound sounds are CC0, CC-BY or CC-BY-NC; credit Freesound and its uploaders.
"""
import argparse, csv, hashlib, importlib.util, json, os, re, subprocess, sys, time, urllib.parse, urllib.request, warnings
from concurrent.futures import ThreadPoolExecutor
import numpy as np
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import FREESOUND  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
UA = {'User-Agent': 'Mozilla/5.0 (DGE research; non-commercial tagger training)'}
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
norm = lambda s: re.sub(r'[\s_\-]+', ' ', s.lower()).strip()
synth_held = lambda user: int(h('synth-fresh-up', f'freesound-user:{user}')[:8], 16) % 5 == 0   # the synth-clip test's uploader rule
is_test = lambda user: int(h('dge-audio-model-freesound-test', user)[:8], 16) % 10 == 0

def fetch(url, headers=None, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410): return None
            time.sleep((8 if e.code == 429 else 2) * (i + 1))
        except Exception: time.sleep(2 * (i + 1))
    return None

def targets():
    spec = importlib.util.spec_from_file_location('labeler', os.path.join(ROOT, 'scripts/label-sample-library.py'))
    cwd = os.getcwd(); os.chdir(ROOT)
    try: lab = importlib.util.module_from_spec(spec); spec.loader.exec_module(lab)
    finally: os.chdir(cwd)
    cat = {c['label']: c for c in json.load(open(os.path.join(ROOT, 'src/audio/djCatalog.json')))['categories']}
    out = {}
    for l in FREESOUND:
        terms = {norm(t) for t in [l] + cat[l].get('aliases', []) + lab.extra.get(l, [])}
        terms |= {norm(p) for t in list(terms) if '/' in t for p in t.split('/')}
        out[l] = {t for t in terms if t and '/' not in t and len(t) > 2}
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--per-label', type=int, default=400)
    ap.add_argument('--per-uploader', type=int, default=4); ap.add_argument('--limit', type=int, default=0); ap.add_argument('--workers', type=int, default=16)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    meta = pq.read_table(hf_hub_download('Chr0my/freesound.org', 'freesound_parquet.parquet', repo_type='dataset')).to_pydict()
    fsd_eval = {r['fname'] for r in csv.DictReader(open(hf_hub_download('Fhrozen/FSD50k', 'labels/eval.csv', repo_type='dataset')))}
    bad_ids, bad_users = set(fsd_eval), set()
    for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
        d = json.load(open(os.path.join(ROOT, f)))
        bad_ids |= set(map(str, d.get('freesoundIds', [])))
        bad_users |= {u.removeprefix('freesound-user:') for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
    T = targets(); hits = {l: [] for l in T}; named = {}
    for sid, title, tags, user in zip(meta['id'], meta['title'], meta['tags:'], meta['username']):
        if str(sid) in bad_ids or user in bad_users or synth_held(user): continue
        ts = {norm(x) for x in (tags or '').split(',') if x.strip()}; ttl = ' ' + norm(title or '') + ' '
        ls = [l for l, terms in T.items() if any(t in ts or (' ' in t and f' {t} ' in ttl) for t in terms)]
        if ls: named[sid] = (user, ls)
        for l in ls: hits[l].append(sid)
    picked = {}
    for l, sids in hits.items():
        sids.sort(key=lambda s: h(l, s)); per, n = {}, 0
        for s in sids:
            if n >= args.per_label: break
            u = named[s][0]
            if per.get(u, 0) >= args.per_uploader: continue
            per[u] = per.get(u, 0) + 1; n += 1; picked[s] = named[s]
    sids = sorted(picked)[:args.limit or None]
    print(f'{len(sids)} Freesound sounds for {len(T)} tags from {len({picked[s][0] for s in sids})} uploaders', flush=True)

    # Preview URLs need the uploader's numeric id; one sound page per uploader gives it.
    users = {}
    for s in sids: users.setdefault(picked[s][0], s)
    def uid(item):
        user, s = item; page = fetch(f'https://freesound.org/people/{urllib.parse.quote(user)}/sounds/{s}/')
        m = page and re.search(rb'cdn\.freesound\.org/previews/\d+/\d+_(\d+)-hq\.mp3', page)
        return user, m and m.group(1).decode()
    with ThreadPoolExecutor(4) as pool: ids = dict(pool.map(uid, users.items()))
    print(f'{sum(v is not None for v in ids.values())} of {len(ids)} uploader ids found', flush=True)

    def audio(s):
        u = ids.get(picked[s][0])
        if not u: return None
        data = fetch(f'https://cdn.freesound.org/previews/{s // 1000}/{s}_{u}-hq.mp3', {'Range': 'bytes=0-250000'})
        if not data or len(data) < 8000: return None
        try:
            pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-t', '10', '-ac', '1', '-ar', '32000', '-f', 's16le', 'pipe:1'],
                                 input=data, capture_output=True, check=True).stdout
        except subprocess.CalledProcessError: return None
        x = np.frombuffer(pcm, np.int16)[:320000]
        return np.pad(x, (0, 320000 - len(x))) if len(x) > 3200 else None

    import torch
    sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
    from models.preprocess import AugmentMelSTFT
    mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
    train_ids = [s for s in sids if not is_test(picked[s][0])]; test_ids = [s for s in sids if is_test(picked[s][0])]
    labels = lambda s: {**{f'cat:{l}': 0.0 for l in T}, **{f'cat:{l}': 1.0 for l in picked[s][1]}}
    weak = lambda s: [f'cat:{l}' for l in T if l not in picked[s][1]]

    raw_path = os.path.join(args.out, 'freesound-mel.raw'); raw = open(raw_path, 'wb'); items, batch = [], []
    def flush():
        with torch.no_grad(): m = mel(torch.from_numpy(np.stack([x for _, x in batch]).astype(np.float32) / 32768))[:, :, :1000].numpy().astype(np.float16)
        for (s, _), v in zip(batch, m):
            raw.write(v.tobytes()); u = picked[s][0]
            items.append({'id': f'freesound:{s}', 'artist': f'freesound-user:{u}', 'row': len(items), 'labels': labels(s), 'weakAbsent': weak(s)})
        batch.clear()
    with ThreadPoolExecutor(args.workers) as pool:
        for k, (s, x) in enumerate(zip(train_ids, pool.map(audio, train_ids))):
            if x is not None: batch.append((s, x))
            if len(batch) == 64: flush()
            if k % 2000 == 0: print(f'  train {k}/{len(train_ids)}', flush=True)
        if batch: flush()
        raw.close()
        src = np.memmap(raw_path, dtype=np.float16, mode='r', shape=(len(items), 128, 1000))
        dst = np.lib.format.open_memmap(os.path.join(args.out, 'freesound-mel.npy'), mode='w+', dtype=np.float16, shape=src.shape)
        for k in range(0, len(items), 2048): dst[k:k + 2048] = src[k:k + 2048]
        dst.flush(); del dst, src; os.remove(raw_path)
        json.dump({'source': 'freesound.org previews; metadata hf://datasets/Chr0my/freesound.org', 'items': items}, open(os.path.join(args.out, 'freesound.json'), 'w'))
        pos = {l: sum(it['labels'][f'cat:{l}'] for it in items) for l in T}
        print(f'train: {len(items)} of {len(train_ids)} sounds fetched; positives ' + ', '.join(f'{l} {int(n)}' for l, n in sorted(pos.items(), key=lambda kv: kv[1])), flush=True)
        test, wavs = [], []
        for s, x in zip(test_ids, pool.map(audio, test_ids)):
            if x is None: continue
            wavs.append(x); test.append({'id': f'freesound:{s}', 'artist': picked[s][0], 'labels': {k: 'present' if v else 'absent' for k, v in labels(s).items()},
                                         'weak': weak(s)})
    np.save(os.path.join(args.out, 'eval-freesound.npy'), np.stack(wavs) if wavs else np.zeros((0, 320000), np.int16))
    json.dump({'source': 'freesound.org previews', 'items': test}, open(os.path.join(args.out, 'eval-freesound.json'), 'w'))
    print(f'test: {len(test)} sounds from {len({t["artist"] for t in test})} held-out uploaders', flush=True)

if __name__ == '__main__':
    main()
