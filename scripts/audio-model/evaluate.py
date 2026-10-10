"""Score the exported tagger (export.py) on benchmark clips, the way DGE's own scorers count.

Usage: python3 scripts/audio-model/evaluate.py <model.onnx> <thresholds.json> <out.json> <eval-dir>/<name> [...]

Each <eval-dir>/<name> is a pair written by prepare.py, prepare-holdout.py, prepare-fsd50k.py or prepare-nsynth.py: <name>.json ({items: [{id, artist, labels:
{class: 'present'|'absent'}, weak?: [class...]}]}) and <name>.npy (int16 32 kHz mono [N, samples], or one flat array cut by the json's `offsets`). Sets labelled with OpenMIC's names are
scored on the 12 classes DGE's DJ clip reports use; sets labelled with app names ('cat:<label>') on every one they label. A clip longer than
10 s is cut into whole 10 s windows, and a tag counts as shown when any window passes its threshold, the app's rule for
fused tags (fusionPresentation.ts). Only explicit present/absent pairs are scored; a label listed in `weak` (untagged
by the uploader) only counts in the weak view. Thresholds were chosen on validation artists only (calibrate.py).
"""
import json, os, sys
import numpy as np
import onnxruntime as ort
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fsd50k_extra  # noqa: E402

model, thresholds, out_path, *sets = sys.argv[1:]
th = json.load(open(thresholds))
classes = json.load(open(os.path.join(os.path.dirname(model), 'model.json')))['classes']
sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
MAP = {'drums': 'drums', 'voice': 'voice', 'synthesizer': 'synthesizer', 'piano': 'piano', 'guitar': 'guitar', 'bass': 'bass',
       'cymbals': 'cymbals', 'organ': 'organ', 'violin': 'violin', 'trumpet': 'trumpet', 'saxophone': 'saxophone', 'cello': 'cello'}

def windows(x):
    """A clip's whole 10 s windows, or one window padded with silence if it is shorter."""
    x = np.asarray(x, np.float32) / 32768; n = max(1, len(x) // 320000)
    return [np.pad(x[k * 320000:(k + 1) * 320000], (0, max(0, 320000 - len(x[k * 320000:(k + 1) * 320000])))) for k in range(n)]

def scores(clips):
    """Max score over each clip's windows, run 16 windows at a time."""
    m = np.full((len(clips), len(classes)), -1.0, np.float32); buf, owner = [], []
    def run():
        for i, row in zip(owner, sess.run(None, {'samples32k': np.stack(buf)})[0]): m[i] = np.maximum(m[i], row)
        buf.clear(); owner.clear()
    for i in range(len(clips)):
        for w in windows(clips[i]):
            buf.append(w); owner.append(i)
            if len(buf) == 16: run()
    if buf: run()
    return m

class Ragged:   # clips stored back to back (eval-fsd50k), cut by offsets
    def __init__(self, flat, offsets): self.flat, self.off = flat, offsets
    def __len__(self): return len(self.off) - 1
    def __getitem__(self, i): return self.flat[self.off[i]:self.off[i + 1]]

report = {}
for base in sets:
    name = os.path.basename(base)
    meta = json.load(open(base + '.json')); items = meta['items']
    if name == 'eval-fsd50k': print(f'{name}: {fsd50k_extra.relabel(items, "eval", strings=True)} labels added (fsd50k_extra.py)', flush=True)
    wav = np.load(base + '.npy', mmap_mode='r'); s = scores(Ragged(wav, meta['offsets']) if 'offsets' in meta else wav)
    named = sorted({c for it in items for c in it['labels']} & set(classes) & set(th))
    score_these = [c for c in MAP if c in named] if any(c in MAP for c in named) else named
    views = {'strict': False, 'weak': True} if any(it.get('weak') for it in items) else {'all': False}
    report[name] = {}
    for view, use_weak in views.items():
        table = {}
        for c in score_these:
            j = classes.index(c); t = th[c].get('threshold') if th[c]['enabled'] else None
            tp = fp = fn = pos = neg = 0
            for i, it in enumerate(items):
                st = it['labels'].get(c)
                if st is None or (c in it.get('weak', []) and not use_weak): continue
                hit = t is not None and s[i, j] >= t
                if st == 'present': pos += 1; tp += hit; fn += not hit
                else: neg += 1; fp += hit
            table[c] = {'precision': round(tp / (tp + fp), 3) if tp + fp else None, 'recall': round(tp / pos, 3) if pos else None,
                        'truePositives': int(tp), 'falseDetections': int(fp), 'positives': pos, 'negatives': neg, 'enabled': t is not None}
        report[name][view] = table
        print(f'== {name} ({view}, {len(items)} clips)')
        for c, r in table.items():
            print(f'  {c:24s} P {r["precision"]}  R {r["recall"]}  ({r["truePositives"]} TP / {r["falseDetections"]} FP; {r["positives"]} pos, {r["negatives"]} neg)'
                  + ('' if r['enabled'] else '  [off]'))
json.dump(report, open(out_path, 'w'), indent=1)
