"""More Slakh2100 train tracks for the rare orchestral and mallet labels (run 7), with prepare-slakh.py's own labels.

Usage: python3 scripts/audio-model/prepare-slakh-more.py <out-dir> [--skip 600] [--windows 4] [--workers 8] [--limit N]
  -> slakhmore-mel.npy + slakhmore.json   same format as slakh-mel.npy / slakh.json

prepare-slakh.py (cached, unchanged) reads the first 600 redux train tracks in its hash order. This reads the train tracks
after those, keeping only tracks with an audible-label patch for a rare label (RARE below), so its windows add
orchestral, mallet and bell positives without re-reading the cached tracks. Validation and test splits are never read
here (the cached source already holds its 100 validation tracks); about 1 track in 10 (by hash) is kept as validation.

Why not "relabel by GM program": Slakh renders each stem with a Kontakt patch, and prepare-slakh.py already labels every
patch the redux train and validation splits use (a survey of all 1,289 train and 270 validation tracks found no unmapped
patch). The GM programs that would add tags (banjo, sitar, steel drum, kalimba) never occur in rendered stems; 'Whistle'
is played by flute patches and 'Lead 1 (square)' by generic lead patches, so neither sound can be labelled from it.
"""
import argparse, importlib.util, json, os, shutil, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location('prepare_slakh', os.path.join(HERE, 'prepare-slakh.py'))
ps = importlib.util.module_from_spec(spec); spec.loader.exec_module(ps)

RARE = {'viola', 'cello', 'double bass', 'tuba', 'horn', 'oboe', 'bassoon', 'clarinet', 'trombone', 'trumpet', 'harp', 'mallet instrument',
        'glockenspiel', 'marimba', 'xylophone', 'vibraphone', 'bell', 'violin / fiddle'}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--skip', type=int, default=600)
    ap.add_argument('--windows', type=int, default=4); ap.add_argument('--workers', type=int, default=8); ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    args.cache = os.path.join(args.out, 'slakhmore-download'); args.source = 'midi'; args.token = None
    yaml = ps.need('yaml', 'pyyaml')
    from concurrent.futures import ThreadPoolExecutor
    from huggingface_hub import list_repo_files
    files = list_repo_files(ps.MIX[0], repo_type='dataset', revision=ps.MIX[1])
    train = sorted({f.split('/')[2] for f in files if f.startswith('data/train/') and f.endswith('/mix.flac')}, key=lambda t: ps.h('dge-slakh', t))[args.skip:]
    def rare_of(tr):
        try:
            meta = yaml.safe_load(open(ps.fetch(*ps.META, f'train/{tr}/metadata.yaml', os.path.join(args.cache, 'meta', tr))))
            return tr, {l for v in (meta.get('stems') or {}).values() if v.get('audio_rendered') for l in ps.stem_labels(v)[0]} & RARE
        except Exception: return tr, set()
    with ThreadPoolExecutor(16) as pool: keep = [tr for tr, r in pool.map(rare_of, train) if r]
    if args.limit: keep = keep[:args.limit]
    print(f'slakhmore: {len(keep)} of {len(train)} unread train tracks have a rare-label patch', flush=True)

    import torch
    sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
    from models.preprocess import AugmentMelSTFT
    mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
    raw_path = os.path.join(args.out, 'slakhmore-mel.raw'); raw = open(raw_path, 'wb'); items, batch = [], []
    def flush():
        with torch.no_grad(): m = mel(torch.from_numpy(np.stack([x for _, x in batch]).astype(np.float32) / 32768))[:, :, :1000].numpy().astype(np.float16)
        for (it, _), v in zip(batch, m): raw.write(v.tobytes()); it['row'] = len(items); items.append(it)
        batch.clear()
    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as pool:
        for k, (got, _) in enumerate(pool.map(lambda tr: ps.track(args, 'train', tr), keep)):
            for it, x in got:
                it['id'] = it['id'].replace('slakh:', 'slakhmore:', 1)
                it['val'] = int(ps.h('dge-slakhmore-val', it['artist'])[:8], 16) % 10 == 0
                batch.append((it, x))
                if len(batch) == 64: flush()
            if k % 50 == 0: print(f'  track {k}/{len(keep)}  {len(items) + len(batch)} windows  {time.time() - t0:.0f} s', flush=True)
    if batch: flush()
    raw.close(); shutil.rmtree(args.cache, ignore_errors=True)
    src = np.memmap(raw_path, dtype=np.float16, mode='r', shape=(len(items), 128, 1000))
    dst = np.lib.format.open_memmap(os.path.join(args.out, 'slakhmore-mel.npy'), mode='w+', dtype=np.float16, shape=src.shape)
    for k in range(0, len(items), 2048): dst[k:k + 2048] = src[k:k + 2048]
    dst.flush(); del dst, src; os.remove(raw_path)
    json.dump({'source': f'Slakh2100 redux (CC BY 4.0) train tracks after the first {args.skip}, rare-label patches only; labels as prepare-slakh.py (midi)',
               'items': items}, open(os.path.join(args.out, 'slakhmore.json'), 'w'))
    pos = {}
    for it in items:
        for c, v in it['labels'].items(): pos[c[4:]] = pos.get(c[4:], 0) + v
    print(f'slakhmore: {len(items)} windows from {len(keep)} tracks; positives ' + ', '.join(f'{l} {int(v)}' for l, v in sorted(pos.items(), key=lambda kv: -kv[1]) if v), flush=True)

if __name__ == '__main__':
    main()
