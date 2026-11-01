"""Staged round A/B audio (stage-birds.py, stage-guitarfx.py) -> a training source and its held-out eval file.

  python3 prepare-staged.py <stage dir> <out dir> --name birds --frames 1000 --eval eval-birds --eval-tag 'bird ambience' --eval-cap 1200
  python3 prepare-staged.py <stage dir> <out dir> --name guitarfx --frames 600 --eval eval-distorted --eval-tag distorted --eval-cap 1500

<stage dir> holds manifest.csv and audio-NNN.tar. Rows with split train/val become <name>-mel.npy + <name>.json (labels
from the manifest's tags (present) and absent columns; every other tag stays unknown; val=True on validation rows; the
row's group is its 'artist', so calibration keeps groups together). Rows with split heldout are never written to the
training file: a balanced sample (--eval-tag present/absent, at most --eval-cap) becomes <eval>.npy (int16, 10 s at
32 kHz) + <eval>.json, which evaluate.py scores. Held-out rows are re-checked against the reserved lists first.
"""
import argparse, csv, importlib, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import round_abc as R
PE = 'prepare-extra.py'   # named as a string so prep-cache.py keys on it
pe = importlib.import_module(PE[:-3])


def item_labels(row):
    present = [t for t in row['tags'].split(';') if t]; absent = [t for t in row['absent'].split(';') if t]
    if set(present) & set(absent): raise SystemExit(f"{row['id']}: a tag is both present and absent")
    return {**{f'cat:{t}': 1.0 for t in present}, **{f'cat:{t}': 0.0 for t in absent}}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('stage'); ap.add_argument('out'); ap.add_argument('--name', required=True); ap.add_argument('--frames', type=int, default=1000)
    ap.add_argument('--eval', required=True); ap.add_argument('--eval-tag', action='append', required=True)
    ap.add_argument('--eval-cap', type=int, default=1200); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    rows = list(csv.DictReader(open(os.path.join(a.stage, 'manifest.csv'))))
    R.check_groups(rows); R.assert_reserved_held(rows)
    held = [r for r in rows if r['split'] == 'heldout']
    picked = {}
    for t in a.eval_tag:
        for r in R.eval_pick(held, t, a.eval_cap // len(a.eval_tag)): picked[r['file']] = r
    train = {r['file']: r for r in rows if r['split'] in ('train', 'val')}
    if a.limit: train = dict(list(train.items())[:a.limit])
    from labels_extra import EXTRA_CAT
    known = set(pe.L.CAT) | set(EXTRA_CAT)   # the trainer's cat: outputs
    w = pe.Writer(a.out, a.name, a.frames); secs = a.frames / 100
    wavs, items = [], []
    for key, data in R.iter_shards(a.stage):
        if key in train:
            r = train[key]; lab = item_labels(r)
            if not all(k[4:] in known for k in lab): raise SystemExit(f'{r["id"]}: a tag the trainer has no output for')
            x = pe.decode(data, secs)
            if x is not None: w.add({'id': r['id'], 'artist': r['group'], 'val': r['split'] == 'val', 'labels': lab, 'weakAbsent': [], 'source': r['dataset']}, x)
        elif key in picked:
            r = picked[key]; x = pe.decode(data, 10)
            lab = {k: 'present' if v else 'absent' for k, v in item_labels(r).items() if k[4:] in a.eval_tag or k[4:] in ('guitar', 'electric guitar', 'animal sound')}
            if x is not None: wavs.append((x * 32767).astype(np.int16)); items.append({'id': r['id'], 'artist': r['group'], 'labels': lab})
    w.close(f"{a.name}: " + ', '.join(sorted({f"{r['dataset']} ({r['licence']})" for r in rows})))
    np.save(os.path.join(a.out, f'{a.eval}.npy'), np.stack(wavs) if wavs else np.zeros((0, 320000), np.int16))
    json.dump({'source': f'{a.name} held-out groups (never trained): ' + ', '.join(sorted({r["dataset"] for r in held})), 'items': items},
              open(os.path.join(a.out, f'{a.eval}.json'), 'w'))
    pos = {t: sum(it['labels'].get(f'cat:{t}') == 'present' for it in items) for t in a.eval_tag}
    print(f'{a.eval}: {len(items)} held-out clips from {len({it["artist"] for it in items})} groups; present {pos}', flush=True)


if __name__ == '__main__':
    main()
