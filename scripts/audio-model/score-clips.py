"""Scores the shipped tagger's app-tag outputs (cat:<tag>) on labelled held-out clips, e.g. the Freesound DJ-effect or
sound-tag clips of held-out uploaders (scripts/dj-effects), to check tags the tagger only passed on rendered notes
against real recordings before the app reads them.

Each clip is cut as the app cuts it (src/audio/tagger.ts): whole 10 s windows from the start, one window padded with
silence when shorter; a clip's score is its best window. A tag is shown at the output's validation threshold
(thresholds.json of the model repo). As in scripts/dj-effects/train.py, a clip tagged with a related tag (labels file
"overlap") is neither a positive nor a negative for the tag. Held-out clips only; aggregates only.
Usage: score-clips.py <audio manifest.json> <model.onnx> <model.json> <thresholds.json> <labels.json> <out.json> [tags...]
  The manifest is fetch-freesound-previews.mjs's (clips with path, labels, split). Without tags: every label in the
  labels file that has a cat: output."""
import json, subprocess, sys
import numpy as np, onnxruntime as ort

MAN, ONNX, MODEL, THR, LABELS, OUT, *TAGS = sys.argv[1:]
RATE, WIN = 32000, 320000
classes = json.load(open(MODEL))['classes']; thr = json.load(open(THR)); spec = json.load(open(LABELS))
overlap = [set(s) for s in spec.get('overlap', [])]
related = lambda a, b: a == b or any(a in s and b in s for s in overlap)
tags = TAGS or [l['label'] for l in spec['labels']]
tags = [t for t in tags if f'cat:{t}' in classes and 'threshold' in thr.get(f'cat:{t}', {})]   # disabled outputs have no threshold
clips = [c for c in json.load(open(MAN))['clips'] if c.get('split') == 'heldout']
sess = ort.InferenceSession(ONNX, providers=['CPUExecutionProvider']); name = sess.get_inputs()[0].name
idx = [classes.index(f'cat:{t}') for t in tags]

def windows(path):
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, np.float32)
    n = max(1, min(3, len(x) // WIN))
    return np.stack([np.pad(x[k * WIN:(k + 1) * WIN], (0, max(0, WIN - len(x[k * WIN:(k + 1) * WIN])))) for k in range(n)]).astype(np.float32)

scores = {}
for k, c in enumerate(clips):
    try: w = windows(c['path'])
    except Exception: continue
    s = np.max(np.stack([sess.run(None, {name: w[i:i + 1]})[0][0] for i in range(len(w))]), axis=0)
    scores[c['id']] = s[idx]
    if k % 250 == 0: print(f'{k}/{len(clips)} clips', flush=True)
labs = {c['id']: set(c['labels']) for c in clips}
report = {}
for j, t in enumerate(tags):
    th = thr[f'cat:{t}']['threshold']; tp = fp = fn = 0
    for cid, s in scores.items():
        L = labs[cid]; pos = t in L
        if not pos and any(related(t, o) for o in L): continue
        hit = bool(s[j] >= th)
        tp += pos and hit; fp += (not pos) and hit; fn += pos and not hit
    P = tp / (tp + fp) if tp + fp else None; R = tp / (tp + fn) if tp + fn else None
    report[t] = {'threshold': th, 'positives': tp + fn, 'tp': tp, 'fp': fp, 'fn': fn, 'precision': P, 'recall': R,
                 'pass70': P is not None and R is not None and P >= .7 and R >= .7 and tp + fn >= 10}
json.dump({'kind': 'tagger-on-heldout-clips-v1', 'clips': len(scores), 'tags': report}, open(OUT, 'w'), indent=1)
f = lambda x: '  -  ' if x is None else f'{x:.2f}'
for t, r in report.items(): print(f"{t:<20} P {f(r['precision'])} R {f(r['recall'])}  ({r['positives']}+){'  PASS' if r['pass70'] else ''}")
