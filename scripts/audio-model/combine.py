"""One browser model from several tagger runs: for each tag the app uses, the run that scored best on held-out audio.

Usage: python3 scripts/audio-model/combine.py <out-dir> <policy.json> <run-dir> [<run-dir> ...] [--keep drums,...]

Each <run-dir> holds a run's model.pt, log.json (backbone in args.model, class list in classes), thresholds.json
(calibrate.py) and eval.json (evaluate.py on the held-out sets). A later run may add outputs after the shipped run's
class list; the file then carries the longest list among the runs it uses, an output the shipped run lacks coming from
the first used run that has it. The first run is the one the app ships today; another run takes a tag only when
  * its mean min(precision, recall) over the held-out sets that score the tag (DJ clip rounds 1 and 2 for instruments;
    FSD50K eval, NSynth test and effect renders, held-out Freesound uploaders for the app-named tags) is at least 0.01
    higher, and
  * it does not drop below 0.70 precision or recall on a set where the shipped run reached both.
Tags in --keep stay with the first run (their long-recording thresholds were tuned on its scores). --only RUN=TAG,...
limits a run to the listed tags (it still has to win them under the rule above), so a new run can ship only the
outputs it was shown to improve. Every other output keeps the first run's score. Runs that win no tag are left out of
the file.

Usage with --only: combine.py out policy.json runs/a runs/b runs/c --keep drums --only 'c=cat:bell,cat:percussion'

Writes <out-dir>/model.onnx (one shared log-mel front end, the chosen networks side by side, each output taken from
its run), model.json (classes, sha256, which run each output comes from), thresholds.json (each output's threshold
from its run) and picks.json (per tag: the held-out numbers of every run and the choice). Checks the ONNX output
against each run's own PyTorch model before writing.
"""
import argparse, hashlib, json, os, sys, warnings
import numpy as np
warnings.filterwarnings('ignore')
import torch
import torch.nn as nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export import FrontEnd, get_model  # noqa: E402
from train import WIDTH, FRAMES  # noqa: E402

INSTRUMENT_SETS = ['eval-round1', 'eval-round2']
TAG_SETS = ['eval-fsd50k', 'eval-nsynth-test', 'eval-nsynth-test-fx', 'eval-freesound']

def rows(ev, tag):
    """(set, precision, recall) for every held-out set scoring the tag with complete labels."""
    out = []
    for name in (TAG_SETS if tag.startswith('cat:') else INSTRUMENT_SETS):
        views = ev.get(name, {}); r = (views.get('all') or views.get('strict') or {}).get(tag)
        if r and r['positives']: out.append((name, r['precision'] or 0.0, r['recall'] or 0.0))
    return out

def merit(rs): return float(np.mean([min(p, r) for _, p, r in rs])) if rs else None

def choose(tags, runs, keep, only=None):
    only = only or {}
    picks = {}
    for tag in tags:
        base = rows(runs[0]['eval'], tag); best, why = 0, 'shipped run'
        if tag not in keep and base:
            passed, top = {n for n, p, r in base if p >= .7 and r >= .7}, merit(base) + .01
            for k, run in enumerate(runs[1:], 1):
                if run['name'] in only and tag not in only[run['name']]: continue
                rs = rows(run['eval'], tag); m = merit(rs)
                if m is None or {n for n, *_ in rs} != {n for n, *_ in base}: continue
                if any(n in passed and (p < .7 or r < .7) for n, p, r in rs): continue
                # The margin is over the shipped run; among the runs that clear it, the best wins whatever the order (ties: the earlier).
                if m >= top and (best == 0 or m > top): best, top, why = k, m, f'mean min(P, R) {merit(base):.3f} -> {m:.3f}'
        elif tag in keep: why = 'kept (long-recording threshold tuned on the shipped run)'
        picks[tag] = {'run': runs[best]['name'], 'why': why,
                      'heldOut': {run['name']: {n: [round(p, 3), round(r, 3)] for n, p, r in rows(run['eval'], tag)} for run in runs}}
    return picks

class Combined(nn.Module):
    def __init__(self, nets, sizes, source):
        super().__init__(); self.front = FrontEnd(); self.nets = nn.ModuleList(nets); self.sizes = sizes; self.total = len(source)
        self.register_buffer('mask', torch.tensor([[float(s == k) for s in source] for k in range(len(nets))]))
    def forward(self, samples32k):
        mel = self.front(samples32k)[:, :, :FRAMES].unsqueeze(1)
        out = 0
        for k, net in enumerate(self.nets):
            y = torch.sigmoid(net(mel)[0].reshape(-1, self.sizes[k]))
            if self.sizes[k] < self.total: y = nn.functional.pad(y, (0, self.total - self.sizes[k]))   # outputs this run lacks
            out = out + y * self.mask[k]
        return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('policy'); ap.add_argument('runs', nargs='+')
    ap.add_argument('--keep', default='')
    ap.add_argument('--only', action='append', default=[], help='RUN=TAG,TAG,...: that run may take only these tags')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    runs = []
    for d in args.runs:
        log = json.load(open(os.path.join(d, 'log.json')))
        runs.append({'name': os.path.basename(os.path.normpath(d)), 'dir': d, 'model': log['args']['model'], 'classes': log['classes'],
                     'eval': json.load(open(os.path.join(d, 'eval.json'))), 'th': json.load(open(os.path.join(d, 'thresholds.json')))})
    for r in runs: assert r['classes'][:len(runs[0]['classes'])] == runs[0]['classes'], f"{r['name']} has a different class list"
    tags = [t['output'] for t in json.load(open(args.policy))['tags']]
    only = {name: {t for t in ts.split(',') if t} for name, ts in (o.split('=', 1) for o in args.only)}
    assert set(only) <= {r['name'] for r in runs}, f'--only names a run that is not given: {set(only)}'
    picks = choose(tags, runs, {t for t in args.keep.split(',') if t}, only)
    used = [k for k, run in enumerate(runs) if k == 0 or any(p['run'] == run['name'] for p in picks.values())]
    CLASSES = max((runs[k]['classes'] for k in used), key=len)
    for k in used: assert CLASSES[:len(runs[k]['classes'])] == runs[k]['classes'], f"{runs[k]['name']} has a different class list"
    first = lambda c: next(k for k in used if c in runs[k]['classes'])
    pick = {c: next(k for k, r in enumerate(runs) if r['name'] == picks[c]['run']) if c in picks else first(c) for c in CLASSES}
    names = [runs[k]['name'] for k in used]
    source = [used.index(pick[c]) for c in CLASSES]
    nets = []
    for k in used:
        net = get_model(width_mult=WIDTH[runs[k]['model']], pretrained_name=None, num_classes=len(runs[k]['classes']))
        net.load_state_dict(torch.load(os.path.join(runs[k]['dir'], 'model.pt'), map_location='cpu')); nets.append(net.eval())
    sizes = [len(runs[k]['classes']) for k in used]
    model = Combined(nets, sizes, source).eval()
    g = torch.Generator().manual_seed(0); t = torch.arange(320000) / 32000
    probe = torch.stack([0.1 * torch.randn(320000, generator=g),
                         0.3 * torch.sin(2 * np.pi * 220 * t) * (torch.sin(2 * np.pi * 2 * t) > 0) + 0.02 * torch.randn(320000, generator=g)])
    with torch.no_grad():
        mel = model.front(probe)[:, :, :FRAMES].unsqueeze(1)
        each = [torch.sigmoid(net(mel)[0].reshape(-1, n)).numpy() for net, n in zip(nets, sizes)]
    want = np.stack([each[s][:, j] for j, s in enumerate(source)], 1)
    path = os.path.join(args.out, 'model.onnx')
    torch.onnx.export(model, probe, path, input_names=['samples32k'], output_names=['scores'], opset_version=17,
                      dynamic_axes={'samples32k': {0: 'batch'}, 'scores': {0: 'batch'}}, dynamo=False)
    import onnxruntime as ort
    sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    got = sess.run(None, {'samples32k': probe.numpy()})[0]
    assert sess.run(None, {'samples32k': probe[:1].numpy()})[0].shape == (1, len(CLASSES))
    err = float(np.abs(got - want).max()); assert err < 1e-3, f'ONNX differs from the runs by {err}'
    data = open(path, 'rb').read()
    json.dump({'classes': CLASSES, 'input': {'name': 'samples32k', 'sampleRate': 32000, 'samples': 320000, 'channels': 1},
               'output': {'name': 'scores', 'activation': 'sigmoid'},
               'base': ' + '.join(f'EfficientAT {runs[k]["model"]} (AudioSet), MIT' for k in used),
               'runs': names, 'outputRun': {c: names[s] for c, s in zip(CLASSES, source)},
               'sha256': {'model.onnx': hashlib.sha256(data).hexdigest()}, 'bytes': len(data), 'maxAbsErrorVsPyTorch': err},
              open(os.path.join(args.out, 'model.json'), 'w'), indent=1)
    th = {c: runs[used[s]]['th'][c] for c, s in zip(CLASSES, source) if c in runs[used[s]]['th']}
    json.dump(th, open(os.path.join(args.out, 'thresholds.json'), 'w'), indent=1)
    json.dump(picks, open(os.path.join(args.out, 'picks.json'), 'w'), indent=1)
    for tag, p in picks.items(): print(f'{tag:24s} {p["run"]:16s} {p["why"]}')
    print(f'wrote {path} ({len(data) / 1e6:.1f} MB, runs {names}), max |ONNX - PyTorch| = {err:.2e}')

if __name__ == '__main__':
    main()
