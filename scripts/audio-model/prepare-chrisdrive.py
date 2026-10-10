"""Chris's own produced loops, stems and one-shots (TRAIN HALF ONLY) for the tagger's app-named head, plus effect renders
of them.

Usage: python3 scripts/audio-model/prepare-chrisdrive.py <staged-dir> <out-dir> [--windows 3] [--renders 3]
  <staged-dir> holds manifest.csv and audio/<drive id>.wav, staged by stage-chrisdrive.py into a PRIVATE Hugging Face
  dataset (CHRIS_DATA in hf-job.sh). Nothing here is ever committed, published or uploaded as a GitHub artifact.
  -> chrisdrive-mel.npy + chrisdrive.json   the dry files, 10 s windows
  -> chrisfx-mel.npy + chrisfx.json         each dry window re-rendered with --renders different effects (render.MUSIC_FX)

Rights and rules (datasets/chris-drive/README.md on the shared drive): Chris says he produced these and kept the rights
(2026-10-09). Only rows whose split is 'train' are in the staged manifest; the judge half is never staged, read, tuned or
calibrated on, and this script refuses a manifest with any other split. Weights trained with it are CC BY-NC-SA.
Every item carries source='chris-drive' so a model can be rebuilt without them.

Labels come from the producer's file names, so a missing tag means "not named", not "absent": items are POSITIVE-ONLY
(only named tags are labelled; train.py gives every other output zero weight for them). Files with no named tag (Bass,
Keys and Chords stems, Life Recordings) are not used dry at all; their renders teach only the effect that was applied.
A render keeps the file's named tags unless the effect rearranges the audio in time (render.TIME_EDITS).
"""
import argparse, csv, hashlib, json, os, subprocess, sys, warnings
from collections import Counter
import numpy as np
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import CAT  # noqa: E402
from render import MUSIC_FX, TIME_EDITS, apply  # noqa: E402

RATE, SECS = 32000, 10
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def extra_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prepare-extra.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def decode(path):
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 's16le', 'pipe:1'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768

def windows(x, k):
    n = SECS * RATE
    if len(x) <= n: return [(0, np.pad(x, (0, n - len(x))))]
    starts = sorted({int(round((len(x) - n) * (j + 0.5) / k)) for j in range(k)})
    return [(a, x[a:a + n]) for a in starts]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('staged'); ap.add_argument('out')
    ap.add_argument('--windows', type=int, default=3); ap.add_argument('--renders', type=int, default=3)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    rows = list(csv.DictReader(open(os.path.join(args.staged, 'manifest.csv'))))
    bad = [r for r in rows if r.get('split', 'train') != 'train']
    if bad: sys.exit(f'refusing: {len(bad)} manifest rows are not in the train half')
    W = extra_module().Writer; dry, fx = W(args.out, 'chrisdrive', 1000), W(args.out, 'chrisfx', 1000)
    used, missing, pos_fx = [], 0, Counter()
    for r in rows:
        path = os.path.join(args.staged, 'audio', f'{r["drive_id"]}.wav')
        if not os.path.exists(path): missing += 1; continue
        tags = [t for t in r['cat_tags'].split(';') if t in CAT]
        x = decode(path)
        if len(x) < RATE // 4 or np.abs(x).max() < 1e-3: continue
        x = x * min(1.0, 0.9 / float(np.abs(x).max()))
        val = int(h('dge-chrisdrive-val', r['group_hash'])[:8], 16) % 10 == 0       # a loop's mix and stems stay together
        base = {'artist': f'chris-drive:{r["group_hash"]}', 'val': val, 'source': 'chris-drive', 'weakAbsent': []}
        n_win = args.windows if r['kind'] in ('full_loop', 'stem', 'loop') else 1
        for a, wx in windows(x, n_win):
            if np.sqrt(np.mean(wx ** 2)) < 1e-3: continue
            wid = f'chrisdrive:{r["drive_id"]}@{a / RATE:.1f}'
            if tags: dry.add({**base, 'id': wid, 'labels': {f'cat:{t}': 1.0 for t in tags}}, wx)
            picks = sorted(MUSIC_FX, key=lambda e: h('dge-chrisfx', wid, e))[:args.renders]
            for e in picks:
                y = apply(e, wx, f'chrisfx|{wid}|{e}')
                if y is None: continue
                lab = {f'cat:{e}': 1.0}
                if e not in TIME_EDITS: lab.update({f'cat:{t}': 1.0 for t in tags})
                fx.add({**base, 'id': f'{wid}#{e}', 'labels': lab}, y.astype(np.float32)); pos_fx[e] += 1
        used.append(r['drive_id'])
    dry.close('Chris\'s own produced sounds, train half only (chris-drive; CC BY-NC-SA weights); positive-only labels from file names')
    fx.close('Effect renders (render.py MUSIC_FX) of Chris\'s train-half sounds (chris-drive); positive-only')
    json.dump({'source': 'chris-drive', 'split': 'train', 'drive_ids': used}, open(os.path.join(args.out, 'chrisdrive-files.json'), 'w'))
    print(f'chris-drive: {len(used)} of {len(rows)} train files used ({missing} missing from the staged copy); renders ' +
          ', '.join(f'{k} {v}' for k, v in pos_fx.most_common()), flush=True)

if __name__ == '__main__':
    main()
