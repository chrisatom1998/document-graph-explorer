"""Run 7 Freesound sounds (staged privately by stage-freesound.py) as tagger training windows and a held-out test.

Usage: python3 scripts/audio-model/prepare-fsnew.py <staged-dir> <out-dir> [--limit N]
  <staged-dir> holds manifest.csv (id, username, split, tags) and audio/<id>.mp3
  -> fsnew-mel.npy + fsnew.json        split=train sounds (CC0 / CC BY only): first 10 s as 1000 log-mel frames
  -> eval-fsnew.npy + eval-fsnew.json  split=heldout sounds, 10 s int16 32 kHz: test only, never trained, tuned or calibrated on

A sound's own tags are present; the other staged tags are weak absences (uploaders tag selectively), as in
prepare-freesound.py. One uploader in four (by hash) is validation, so calibration has positives for these rare tags.
"""
import argparse, csv, hashlib, importlib.util, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from labelmap import CAT  # noqa: E402
from labels_extra import EXTRA_CAT  # noqa: E402
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('staged'); ap.add_argument('out'); ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    rows = list(csv.DictReader(open(os.path.join(args.staged, 'manifest.csv'))))
    if args.limit: rows = rows[::max(1, len(rows) // args.limit)]
    known = set(CAT) | set(EXTRA_CAT)
    T = sorted({t for r in rows for t in r['tags'].split('|')} & known)
    missing = sorted({t for r in rows for t in r['tags'].split('|')} - known)
    if missing: print(f'fsnew: no output for {missing}; those labels are dropped', flush=True)
    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(HERE, 'prepare-extra.py'))
    pe = importlib.util.module_from_spec(spec); spec.loader.exec_module(pe)
    w = pe.Writer(args.out, 'fsnew', 1000); items, wavs = [], []
    for r in rows:
        own = set(r['tags'].split('|')) & set(T)
        if not own: continue
        x = pe.decode(open(os.path.join(args.staged, 'audio', f"{r['id']}.mp3"), 'rb').read())
        if x is None: continue
        if r['split'] == 'heldout':
            wavs.append((x * 32767).astype(np.int16))
            items.append({'id': f"freesound:{r['id']}", 'artist': f"freesound-user:{r['username']}",
                          'labels': {f'cat:{l}': 'present' if l in own else 'absent' for l in T}, 'weak': [f'cat:{l}' for l in T if l not in own]})
        elif r['split'] == 'train':
            w.add({'id': f"fsnew:{r['id']}", 'artist': f"freesound-user:{r['username']}", 'val': int(h('dge-fsnew-val', r['username'])[:8], 16) % 4 == 0,
                   'labels': {f'cat:{l}': float(l in own) for l in T}, 'weakAbsent': [f'cat:{l}' for l in T if l not in own], 'source': 'freesound'}, x)
    np.save(os.path.join(args.out, 'eval-fsnew.npy'), np.stack(wavs) if wavs else np.zeros((0, 320000), np.int16))
    json.dump({'source': 'freesound.org previews, heldout rows of the run 7 candidate list (test only)', 'items': items},
              open(os.path.join(args.out, 'eval-fsnew.json'), 'w'))
    print(f'eval-fsnew: {len(items)} held-out sounds from {len({i["artist"] for i in items})} uploaders', flush=True)
    w.close('freesound.org previews (CC0 / CC BY), train rows of the run 7 candidate list; credit Freesound and its uploaders')

if __name__ == '__main__':
    main()
