"""NSynth notes, plain and with one DSP effect, as tagger training windows; NSynth test notes for judging.

Usage: python3 scripts/audio-model/prepare-nsynth.py <out-dir> [--per-instrument 32] [--fx 0.45] [--workers 6]

Streams Magenta's nsynth-train.jsonwav.tar.gz (CC-BY 4.0) and keeps notes of pitch 36-84, velocity >= 50, at most
--per-instrument per instrument, skipping every instrument the short-clip and synth-clip test sets reserve
(docs/evaluations/*/reserved-test-families.json, plus the synth-clips rule). A share --fx of kept notes also get one
render with a DSP effect (render.py), picked by a fixed hash, so the effect heads learn the effect, not the note.
Each note is 4 s; windows are stored as 600 log-mel frames (the note + a 2 s tail) and train.py pads the rest of the
10 s window with silence, as the app does for a short sample.
  -> nsynth-mel.npy + nsynth.json            training (group = instrument; train.py holds 10% of groups out)
  -> eval-nsynth-test.npy/.json              NSynth's own test split (instruments never in train): judging only
  -> eval-nsynth-test-fx.npy/.json           the same test notes, half re-rendered with an effect: judging only
Labels use the tagger's catalog names ('cat:<label>', labelmap.py). Absences of effects on plain notes are weak.
"""
import argparse, hashlib, io, json, os, sys, tarfile, urllib.request, wave, warnings
from multiprocessing import Pool
import numpy as np
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import EFFECTS, NSYNTH_QUALITIES, NSYNTH_TAUGHT, nsynth_labels  # noqa: E402

URL = 'http://download.magenta.tensorflow.org/datasets/nsynth/nsynth-{}.jsonwav.tar.gz'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
FRAMES, L = 600, 192000
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def reserved():
    a = json.load(open(os.path.join(ROOT, 'docs/evaluations/short-clips-2026-10-04/reserved-test-families.json')))
    b = json.load(open(os.path.join(ROOT, 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json')))
    return set(a['nsynthInstruments']) | {s.split(':', 1)[1] for s in b['nsynthTestInstruments']}
def held_by_synth_rule(inst): return int(h('synth-fresh-inst', inst)[:8], 16) % 4 == 0

mel = None
def init():
    global mel
    import torch; torch.set_num_threads(1)
    sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
    from models.preprocess import AugmentMelSTFT
    mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()

def note(data):
    from scipy.signal import resample_poly
    with wave.open(io.BytesIO(data)) as w: x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float64) / 32768
    x = resample_poly(x, 2, 1)[:L]; return np.pad(x, (0, L - len(x)))

def work(job):
    import torch
    from render import apply
    name, data, effect, keep_wav = job
    x = note(data); outs = [(None, x)]
    if effect:
        y = apply(effect, x, f'nsynth-fx|{name}')
        if y is not None: outs.append((effect, y))
    with torch.no_grad():
        m = mel(torch.from_numpy(np.stack([o for _, o in outs]).astype(np.float32)))[:, :, :FRAMES].numpy().astype(np.float16)
    return name, [(e, m[k], (np.clip(o, -1, 1) * 32767).astype(np.int16) if keep_wav else None) for k, (e, o) in enumerate(outs)]

def stream(split, keep, effect_of, workers, on_row, wav=False):
    """Feeds the split's kept notes through `work` in parallel; returns examples.json."""
    examples = None
    def jobs():
        nonlocal examples
        with urllib.request.urlopen(URL.format(split), timeout=300) as res, tarfile.open(fileobj=res, mode='r|gz') as tar:
            for m in tar:
                if m.name.endswith('examples.json'): examples = json.load(tar.extractfile(m)); continue
                if not m.isfile() or not m.name.endswith('.wav'): continue
                n = os.path.basename(m.name)[:-4]
                if keep(n): yield n, tar.extractfile(m).read(), effect_of(n), wav
    with Pool(workers, initializer=init) as pool:
        for name, rows in pool.imap(work, jobs(), chunksize=8): on_row(name, rows)
    return examples

def labels_for(name, ex, effect):
    inst = name.rsplit('-', 2)[0]; family, source = ex['instrument_family_str'], ex['instrument_source_str']
    present = set(nsynth_labels(family, source))
    lab = {f'cat:{l}': float(l in present) for l in NSYNTH_TAUGHT}
    q = set(ex['qualities_str'])
    for nq, l in NSYNTH_QUALITIES.items(): lab[f'cat:{l}'] = float(nq in q)
    weak = [f'cat:{e}' for e in EFFECTS if f'cat:{e}' not in lab]
    for e in weak: lab[e] = 0.0
    if effect:
        tone = {'filtered', 'bright', 'dark', 'distorted', 'bitcrushed', 'saturated'}
        if effect in tone: lab.pop('cat:bright'); lab.pop('cat:dark')
        if effect in ('swelling', 'reverse effect', 'stutter effect'): lab.pop('cat:percussive')
        for nq, l in NSYNTH_QUALITIES.items():   # a render keeps the note's own qualities; its absences become weak
            if f'cat:{l}' in lab and lab[f'cat:{l}'] == 0 and l != effect: weak.append(f'cat:{l}')
        lab[f'cat:{effect}'] = 1.0; weak = [w for w in weak if w != f'cat:{effect}']
    return inst, lab, sorted(set(weak) & set(lab))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--per-instrument', type=int, default=32)
    ap.add_argument('--fx', type=float, default=0.45); ap.add_argument('--workers', type=int, default=6); ap.add_argument('--limit', type=int, default=0); ap.add_argument('--train-split', default='train', help='smoke tests only')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    skip = reserved(); per = {}
    def keep(n):
        inst, pitch, vel = n.rsplit('-', 2); pitch, vel = int(pitch), int(vel)
        if inst in skip or held_by_synth_rule(inst) or not 36 <= pitch <= 84 or vel < 50: return False
        if per.get(inst, 0) >= args.per_instrument or (args.limit and sum(per.values()) >= args.limit): return False
        per[inst] = per.get(inst, 0) + 1; return True
    pick_fx = lambda n: EFFECTS[int(h('nsynth-fx-pick', n)[:8], 16) % len(EFFECTS)] if int(h('nsynth-fx-on', n)[:8], 16) % 1000 < args.fx * 1000 else None

    raw_path = os.path.join(args.out, 'nsynth-mel.raw'); raw = open(raw_path, 'wb'); rows = []
    def on_train(name, outs):
        for effect, m, _ in outs: raw.write(np.ascontiguousarray(m, np.float16).tobytes()); rows.append((name, effect))
    ex = stream(args.train_split, keep, pick_fx, args.workers, on_train)
    items = []
    for i, (name, effect) in enumerate(rows):
        inst, lab, weak = labels_for(name, ex[name], effect)
        items.append({'id': f'nsynth:{name}' + (f'@{effect}' if effect else ''), 'artist': f'nsynth:{inst}', 'row': i, 'labels': lab, 'weakAbsent': weak, 'frames': FRAMES})
    raw.close(); src = np.memmap(raw_path, dtype=np.float16, mode='r', shape=(len(rows), 128, FRAMES))
    dst = np.lib.format.open_memmap(os.path.join(args.out, 'nsynth-mel.npy'), mode='w+', dtype=np.float16, shape=src.shape)
    for k in range(0, len(rows), 2048): dst[k:k + 2048] = src[k:k + 2048]
    dst.flush(); del dst, src; os.remove(raw_path)
    json.dump({'source': URL.format('train'), 'frames': FRAMES, 'items': items}, open(os.path.join(args.out, 'nsynth.json'), 'w'))
    print(f'{len(items)} NSynth training windows ({sum(1 for _, e in rows if e)} effect renders) from {len(per)} instruments; {len(skip)} reserved instruments skipped', flush=True)

    test = []
    fx_test = lambda n: EFFECTS[int(h('nsynth-test-fx-pick', n)[:8], 16) % len(EFFECTS)] if int(h('nsynth-test-fx-on', n)[:8], 16) % 2 else None
    ex = stream('test', lambda n: not args.limit or len(test) < args.limit, fx_test, args.workers, lambda name, outs: test.append((name, outs)), wav=True)
    # Plain notes: instrument labels and NSynth's qualities. Effect set: each note's render if it got one, else the plain note.
    for tag, pick in (('eval-nsynth-test', lambda outs: outs[0]), ('eval-nsynth-test-fx', lambda outs: outs[-1])):
        picked = [(name, *pick(outs)) for name, outs in test]
        np.save(os.path.join(args.out, tag + '.npy'), np.stack([w for _, _, _, w in picked]))
        out = []
        for name, e, _, _ in picked:
            inst, lab, _ = labels_for(name, ex[name], e)
            keys = [f'cat:{x}' for x in EFFECTS] if tag.endswith('fx') else [f'cat:{x}' for x in NSYNTH_TAUGHT + list(NSYNTH_QUALITIES.values())]
            out.append({'id': name + (f'@{e}' if e else ''), 'artist': inst, 'labels': {k: 'present' if lab[k] else 'absent' for k in keys if k in lab}})
        json.dump({'source': URL.format('test'), 'items': out}, open(os.path.join(args.out, tag + '.json'), 'w'))
        print(f'{tag}: {len(out)} notes', flush=True)

if __name__ == '__main__':
    main()
