"""One browser model from several tagger runs: for each tag the app uses, the run that scored best on VALIDATION clips.

Usage: python3 scripts/audio-model/combine.py <out-dir> <policy.json> <run-dir> [<run-dir> ...] [--keep drums,...]
       [--allow-hand-picks --only RUN=a,b --pin RUN=a,b]

Each <run-dir> holds a run's model.pt, log.json (backbone in args.model), thresholds.json (calibrate.py, which also
records each output's precision and recall on every training source's validation clips) and optionally eval.json
(evaluate.py on the held-out test sets). The first run is the one the app ships today. combine_select.py picks each tag's
run from thresholds.json alone: another run takes a tag only when its mean min(precision, recall) over the validation
sources both runs score is at least 0.01 higher, and it does not drop below 0.70 precision or recall on a validation
source where the shipped run reached both. The held-out test sets are never read to choose (they are the corpora the
scoreboard judges, so choosing on them inflates the board); hf-combine-job.sh scores the finished model on them once,
and picks.json keeps every run's test numbers under heldOutReportOnly for the record.
Tags in --keep stay with the first run (their long-recording thresholds were tuned on its scores). --only RUN=a,b limits
RUN to those outputs; --pin RUN=a,b forces those outputs to RUN. Both are hand choices and need --allow-hand-picks; they
must rest on evidence other than the test sets (a test-set win is exactly the selection this file avoids).
A later run may add outputs after the first run's class list; the file then carries the longest list, and an output only
newer runs have comes from the first used run that has it.

Writes <out-dir>/model.onnx (one shared log-mel front end, the chosen networks side by side, each output taken from
its run), model.json (classes, sha256, which run each output comes from), thresholds.json (each output's threshold
from its run) and picks.json (per tag: the choice, why, every run's validation numbers, and the test numbers for the
record). Checks the ONNX output against each run's own PyTorch model before writing.
"""
import argparse, hashlib, json, os, sys, warnings
import numpy as np
warnings.filterwarnings('ignore')
import torch
import torch.nn as nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export import FrontEnd, get_model  # noqa: E402
from train import CLASSES, WIDTH, FRAMES  # noqa: E402
import combine_select  # noqa: E402

INSTRUMENT_SETS = ['eval-round1', 'eval-round2']
TAG_SETS = ['eval-fsd50k', 'eval-nsynth-test', 'eval-nsynth-test-fx', 'eval-freesound']

def rows(ev, tag):
    """(set, precision, recall) for every held-out TEST set scoring the tag. Recorded in picks.json only, never used to choose."""
    out = []
    for name in (TAG_SETS if tag.startswith('cat:') else INSTRUMENT_SETS):
        views = ev.get(name, {}); r = (views.get('all') or views.get('strict') or {}).get(tag)
        if r and r['positives']: out.append((name, r['precision'] or 0.0, r['recall'] or 0.0))
    return out

def choose(tags, runs, keep, only=None, pin=None):
    """Per tag, the run chosen on validation clips (combine_select.py); the test-set numbers ride along for the record."""
    picks = combine_select.choose(tags, runs, keep, only, pin)
    for tag, p in picks.items():
        p['heldOutReportOnly'] = {run['name']: {n: [round(pr, 3), round(rc, 3)] for n, pr, rc in rows(run.get('eval') or {}, tag)} for run in runs}
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
            if self.sizes[k] < self.total: y = nn.functional.pad(y, (0, self.total - self.sizes[k]))
            out = out + y * self.mask[k]
        return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('policy'); ap.add_argument('runs', nargs='+')
    ap.add_argument('--keep', default='')
    ap.add_argument('--only', action='append', default=[], help='RUN=output,output: the only outputs RUN may take')
    ap.add_argument('--pin', action='append', default=[], help='RUN=output,output: outputs taken from RUN whatever the combiner scores')
    ap.add_argument('--allow-hand-picks', action='store_true', help='accept --only/--pin (hand choices that must not come from test-set results)')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    assert args.allow_hand_picks or not (args.only or args.pin), \
        '--only/--pin are hand picks: pass --allow-hand-picks, and only for evidence that is not a held-out test set'
    runs = []
    for d in args.runs:
        log = json.load(open(os.path.join(d, 'log.json')))
        n = min(len(CLASSES), len(log['classes'])); assert log['classes'][:n] == CLASSES[:n], f'{d} has a different class list'   # an older run has fewer outputs than the current list
        runs.append({'name': os.path.basename(os.path.normpath(d)), 'dir': d, 'model': log['args']['model'], 'classes': log['classes'],
                     'eval': json.load(open(os.path.join(d, 'eval.json'))) if os.path.exists(os.path.join(d, 'eval.json')) else {}, 'th': json.load(open(os.path.join(d, 'thresholds.json')))})
    assert all(o.partition('=')[2].strip(', ') for o in args.only), f'--only needs RUN=output,output: {args.only}'
    only = {name: {t for t in ts.split(',') if t} for name, ts in (o.split('=', 1) for o in args.only)}
    assert set(only) <= {r['name'] for r in runs}, f'--only names a run that is not combined: {set(only)}'
    assert all(o.partition('=')[2].strip(', ') for o in args.pin), f'--pin needs RUN=output,output: {args.pin}'
    pin = {t: name for name, ts in (o.split('=', 1) for o in args.pin) for t in ts.split(',') if t}
    assert set(pin.values()) <= {r['name'] for r in runs}, f'--pin names a run that is not combined: {set(pin.values())}'
    for t, name in pin.items(): assert t in next(r for r in runs if r['name'] == name)['classes'], f'{t} is not an output of {name}'
    tags = [t['output'] for t in json.load(open(args.policy))['tags']]
    tags += sorted(({t for ts in only.values() for t in ts} | set(pin)) - set(tags))
    for t in tags: assert any(t in r['classes'] for r in runs), f'{t} is not an output of any run'
    picks = choose(tags, runs, {t for t in args.keep.split(',') if t}, only, pin)
    used = [k for k, run in enumerate(runs) if k == 0 or any(p['run'] == run['name'] for p in picks.values())]
    names = [runs[k]['name'] for k in used]
    classes = max((runs[k]['classes'] for k in used), key=len)
    for k in used: assert classes[:len(runs[k]['classes'])] == runs[k]['classes'], f'{runs[k]["name"]} has a different class list'
    first = lambda c: next(i for i, k in enumerate(used) if c in runs[k]['classes'])
    source = [names.index(picks[c]['run']) if c in picks else first(c) for c in classes]
    nets, sizes = [], [len(runs[k]['classes']) for k in used]
    for k, n in zip(used, sizes):
        net = get_model(width_mult=WIDTH[runs[k]['model']], pretrained_name=None, num_classes=n)
        net.load_state_dict(torch.load(os.path.join(runs[k]['dir'], 'model.pt'), map_location='cpu')); nets.append(net.eval())
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
    assert sess.run(None, {'samples32k': probe[:1].numpy()})[0].shape == (1, len(classes))
    err = float(np.abs(got - want).max()); assert err < 1e-3, f'ONNX differs from the runs by {err}'
    data = open(path, 'rb').read()
    json.dump({'classes': classes, 'input': {'name': 'samples32k', 'sampleRate': 32000, 'samples': 320000, 'channels': 1},
               'output': {'name': 'scores', 'activation': 'sigmoid'},
               'base': ' + '.join(f'EfficientAT {runs[k]["model"]} (AudioSet), MIT' for k in used),
               'runs': names, 'outputRun': {c: names[s] for c, s in zip(classes, source)},
               'sha256': {'model.onnx': hashlib.sha256(data).hexdigest()}, 'bytes': len(data), 'maxAbsErrorVsPyTorch': err},
              open(os.path.join(args.out, 'model.json'), 'w'), indent=1)
    th = {c: runs[used[s]]['th'][c] for c, s in zip(classes, source) if c in runs[used[s]]['th']}
    json.dump(th, open(os.path.join(args.out, 'thresholds.json'), 'w'), indent=1)
    json.dump(picks, open(os.path.join(args.out, 'picks.json'), 'w'), indent=1)
    for tag, p in picks.items(): print(f'{tag:24s} {p["run"]:16s} {p["why"]}')
    print(f'wrote {path} ({len(data) / 1e6:.1f} MB, runs {names}), max |ONNX - PyTorch| = {err:.2e}')

if __name__ == '__main__':
    main()
