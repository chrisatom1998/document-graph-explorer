"""Round 13: extra NSynth train notes for bright and dark, as tagger training windows (prepare-nsynth.py's reader and labels).

Usage: python3 scripts/audio-model/r13-nsynth-notes.py <note list> <out-dir> [--workers 8]
  <note list> names NSynth train notes, one per line (bright / dark quality notes from datasets/round10-uncovered, already
  filtered against the test-leak lists in the project container). Instruments the short-clip and synth-clip test sets reserve
  and the synth-fresh held-out instruments are skipped here too, so a held-out instrument never trains even if listed.
  No cap per instrument, no pitch rule, no effect renders, and no test split (the base prep already holds NSynth test).
  -> nsx-mel.npy + nsx.json   training (group = instrument, as in nsynth.json)
"""
import argparse, importlib.util, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('prepare_nsynth', os.path.join(HERE, 'prepare-nsynth.py'))
pn = importlib.util.module_from_spec(spec); sys.modules['prepare_nsynth'] = pn; spec.loader.exec_module(pn)   # pool workers find it by name


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('notes'); ap.add_argument('out'); ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--split', default='train', help='smoke tests only')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    only = {l.strip() for l in open(args.notes) if l.strip()}; skip = pn.reserved(); insts = set()
    def keep(n):
        inst = n.rsplit('-', 2)[0]
        if n not in only or inst in skip or pn.held_by_synth_rule(inst): return False
        insts.add(inst); return True
    raw_path = os.path.join(args.out, 'nsx-mel.raw'); raw = open(raw_path, 'wb'); rows = []
    def on_row(name, outs):
        for effect, m, _ in outs: raw.write(np.ascontiguousarray(m, np.float16).tobytes()); rows.append(name)
    ex = pn.stream(args.split, keep, lambda n: None, args.workers, on_row)
    raw.close(); items = []
    if not rows: raise SystemExit(f'nsx: none of the {len(only)} listed notes were found')
    for i, name in enumerate(rows):
        inst, lab, weak = pn.labels_for(name, ex[name], None)
        items.append({'id': f'nsynth:{name}', 'artist': f'nsynth:{inst}', 'row': i, 'labels': lab, 'weakAbsent': weak, 'frames': pn.FRAMES})
    src = np.memmap(raw_path, dtype=np.float16, mode='r', shape=(len(rows), 128, pn.FRAMES))
    dst = np.lib.format.open_memmap(os.path.join(args.out, 'nsx-mel.npy'), mode='w+', dtype=np.float16, shape=src.shape)
    for k in range(0, len(rows), 2048): dst[k:k + 2048] = src[k:k + 2048]
    dst.flush(); del dst, src; os.remove(raw_path)
    json.dump({'source': pn.URL.format('train') + ' (round 13 bright / dark notes)', 'frames': pn.FRAMES, 'items': items}, open(os.path.join(args.out, 'nsx.json'), 'w'))
    pos = {q: sum(it['labels'].get(f'cat:{q}', 0) for it in items) for q in ('bright', 'dark')}
    print(f'nsx: {len(items)} of {len(only)} listed NSynth train notes from {len(insts)} instruments; bright {int(pos["bright"])}, dark {int(pos["dark"])}', flush=True)


if __name__ == '__main__':
    main()
