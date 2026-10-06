"""Score the exported tagger (export.py) on benchmark clips, the way DGE's own scorers count.

Usage: python3 scripts/audio-model/evaluate.py <model.onnx> <thresholds.json> <out.json> <eval-dir>/<name> [...]

Each <eval-dir>/<name> is a pair written by prepare.py or prepare-holdout.py: <name>.json ({items: [{id, artist, labels:
{class: 'present'|'absent'}, weak?: [class...]}]}) and <name>.npy (int16 32 kHz mono [N, samples]). A clip longer than
10 s is cut into whole 10 s windows, and a tag counts as shown when any window passes its threshold, the app's rule for
fused tags (fusionPresentation.ts). Only explicit present/absent pairs are scored; a label listed in `weak` (untagged
by the uploader) only counts in the weak view. Thresholds were chosen on validation artists only (calibrate.py).
"""
import json, os, sys
import numpy as np
import onnxruntime as ort

model, thresholds, out_path, *sets = sys.argv[1:]
th = json.load(open(thresholds))
classes = json.load(open(os.path.join(os.path.dirname(model), 'model.json')))['classes']
sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
MAP = {'drums': 'drums', 'voice': 'voice', 'synthesizer': 'synthesizer', 'piano': 'piano', 'guitar': 'guitar', 'bass': 'bass',
       'cymbals': 'cymbals', 'organ': 'organ', 'violin': 'violin', 'trumpet': 'trumpet', 'saxophone': 'saxophone', 'cello': 'cello'}

def scores(wav):
    n = max(1, wav.shape[1] // 320000); out = []
    for s in range(0, len(wav), 16):
        x = np.asarray(wav[s:s + 16], np.float32) / 32768
        win = np.stack([x[:, k * 320000:(k + 1) * 320000] for k in range(n)], 1).reshape(-1, 320000)
        if win.shape[1] < 320000: win = np.pad(win, ((0, 0), (0, 320000 - win.shape[1])))
        out.append(sess.run(None, {'samples32k': win})[0].reshape(len(x), n, len(classes)).max(1))
    return np.concatenate(out)

report = {}
for base in sets:
    name = os.path.basename(base)
    items = json.load(open(base + '.json'))['items']; s = scores(np.load(base + '.npy', mmap_mode='r'))
    views = {'strict': False, 'weak': True} if any(it.get('weak') for it in items) else {'all': False}
    report[name] = {}
    for view, use_weak in views.items():
        table = {}
        for c in MAP:
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
            print(f'  {c:12s} P {r["precision"]}  R {r["recall"]}  ({r["truePositives"]} TP / {r["falseDetections"]} FP; {r["positives"]} pos, {r["negatives"]} neg)'
                  + ('' if r['enabled'] else '  [off]'))
json.dump(report, open(out_path, 'w'), indent=1)
