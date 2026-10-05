"""Do two public drum one-shot classifiers beat or help our short-clip drum heads?

Teachers (both fine-tuned facebook/wav2vec2-base, ~95M parameters, PyTorch only):
  airasoul/wav2vec2-base-drum-kit                    MIT         clap conga crash cymbal hat kick ride rim snare tom
  yojul/wav2vec2-base-one-shot-hip-hop-drums-clf     Apache-2.0  808S CLAPS CYMBALS HITHATS KICKS OPENHATS SNARES

Development data only (train + Surge train + calibration). The frozen test split is never read.
Every number uses the same uploader/preset/participant-grouped 5-fold procedure as
scripts/train-short-clip-heads.py, so it is comparable with development-selection.json:
  teacher alone   threshold on the teacher's own mapped probability, chosen on the other 4 folds
  teacher argmax  the teacher's top class, no tuning at all
  drum clips only both of the above restricted to clips labelled 'percussion hit' or 'clap' (the teachers' intended input)
  clapRepeat      today's selected feature set (re-run here as the baseline)
  clapRepeat+T    clapRepeat plus that teacher's class probabilities as extra features

Usage: <venv>/python scripts/short-clip-drum-teachers.py embed <teacher> [shard shards]   (resumable; CPU; caches beside the features)
       <venv>/python scripts/short-clip-drum-teachers.py compare   > docs/evaluations/short-clips-2026-10-04/drum-teachers.json
Needs torch, transformers, scikit-learn and ffmpeg on PATH.
"""
import glob, importlib.util, json, os, subprocess, sys, datetime
import numpy as np

W = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips'
ROOT = os.path.join(os.path.dirname(__file__), '..')
MODE = sys.argv[1] if len(sys.argv) > 1 else 'compare'
TEACHERS = {
    'airasoul': ('airasoul/wav2vec2-base-drum-kit', {'kick': 'role:kick', 'snare': 'role:snare', 'hat': 'role:hi-hat', 'crash': 'role:cymbal',
                                                     'cymbal': 'role:cymbal', 'ride': 'role:cymbal', 'clap': 'role:clap'}),
    # 808s are tuned sub-bass kicks; they count for neither kick nor bass hit, so they only lower the other classes.
    'yojul': ('yojul/wav2vec2-base-one-shot-hip-hop-drums-clf', {'KICKS': 'role:kick', 'SNARES': 'role:snare', 'HITHATS': 'role:hi-hat',
                                                                 'OPENHATS': 'role:hi-hat', 'CYMBALS': 'role:cymbal', 'CLAPS': 'role:clap'}),
}
CATS = ['role:kick', 'role:snare', 'role:hi-hat', 'role:cymbal', 'role:clap']
MAX_S, RATE = 3.0, 16000   # both cards: 16 kHz mono, first 3 s

manifest = json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/manifest.json'))
test_ids = {i['id'] for i in manifest['items'] if i['split'] == 'test'}
paths = {r['id']: r['path'] for f in ('feature-list.json', 'feature-list-surge.json') if os.path.exists(f'{W}/{f}') for r in json.load(open(f'{W}/{f}'))}

def decode(path):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', path, '-t', str(MAX_S), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)

def cached(name):
    return {r['id']: r['probs'] for f in glob.glob(f'{W}/teacher-{name}*.jsonl') for r in map(json.loads, open(f))}

def embed(name, shard=0, shards=1):
    import torch
    from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
    dev = [i['id'] for i in manifest['items'] if i['split'] == 'calibration']
    dev += [i['id'] for f in ('train-items.json', 'train-items-surge.json') if os.path.exists(f'{W}/{f}') for i in json.load(open(f'{W}/{f}'))['items']]
    assert not set(dev) & test_ids, 'test clips must never be scored here'
    # CPU, sharded across processes: on Apple MPS every new clip length recompiles, which ran ~10x slower.
    torch.set_num_threads(int(os.environ.get('THREADS', '3')))
    repo = TEACHERS[name][0]; done = cached(name)
    todo = [i for k, i in enumerate(dev) if k % shards == shard and i not in done and i in paths]
    print(f'{name} shard {shard}/{shards}: {len(done)} cached, {len(todo)} to score', file=sys.stderr, flush=True)
    fx = AutoFeatureExtractor.from_pretrained(repo)
    model = AutoModelForAudioClassification.from_pretrained(repo).eval()
    labels = [model.config.id2label[k] for k in range(model.config.num_labels)]
    with open(f'{W}/teacher-{name}-{shard}.jsonl', 'a') as f:
        for n, iid in enumerate(todo):
            try: x = decode(paths[iid])
            except subprocess.CalledProcessError: continue
            if len(x) < RATE // 10: continue
            # One clip per call: wav2vec2-base has no attention mask, so batch padding would change the result.
            with torch.no_grad():
                p = torch.softmax(model(fx(x, sampling_rate=RATE, return_tensors='pt').input_values).logits[0], -1).numpy()
            f.write(json.dumps({'id': iid, 'probs': {l: round(float(v), 5) for l, v in zip(labels, p)}}) + '\n'); f.flush()
            if n % 500 == 0: print(f'  {name} shard {shard} {n}/{len(todo)}', file=sys.stderr, flush=True)

def compare():
    from sklearn.model_selection import GroupKFold
    # Reuse the head-selection code unchanged so the baseline is the same procedure that chose today's heads.
    spec = importlib.util.spec_from_file_location('heads', f'{ROOT}/scripts/train-short-clip-heads.py')
    sys.argv = [sys.argv[0], 'import-only']; heads = importlib.util.module_from_spec(spec); spec.loader.exec_module(heads)
    probs = {n: cached(n) for n in TEACHERS}
    keep = [k for k, i in enumerate(heads.DEV) if all(i['id'] in probs[n] for n in TEACHERS)]
    dropped = len(heads.DEV) - len(keep)
    heads.DEV = [heads.DEV[k] for k in keep]; heads.DEV_LAB = [heads.DEV_LAB[k] for k in keep]; heads.DEV_GROUPS = heads.DEV_GROUPS[keep]
    order = {n: sorted(next(iter(probs[n].values()))) for n in TEACHERS}
    base_block = heads.block
    heads.block = lambda items, name: (np.array([[probs[name][i['id']][l] for l in order[name]] for i in items]) if name in TEACHERS else base_block(items, name))

    def mapped(name):
        cls = TEACHERS[name][1]
        P = np.array([[probs[name][i['id']][l] for l in order[name]] for i in heads.DEV])
        top = np.array([cls.get(order[name][k]) for k in P.argmax(1)], dtype=object)
        return {c: P[:, [k for k, l in enumerate(order[name]) if cls.get(l) == c]].sum(1) for c in CATS}, top

    def teacher_alone(score, top, cat, drum_only=False):
        # drum_only: the setting the teachers were built for (one isolated drum hit), e.g. after stem separation.
        m = np.array([cat in l and (not drum_only or 'present' in (l.get('role:percussion hit'), l.get('role:clap'))) for l in heads.DEV_LAB]); y = np.array([l.get(cat) == 'present' for l in heads.DEV_LAB])[m]
        s, g, t = score[m], heads.DEV_GROUPS[m], top[m]
        hit = np.zeros(len(y), bool)
        for a, b in GroupKFold(5).split(s, y, g):
            if y[a].any(): hit[b] = s[b] >= heads.pick_threshold(s[a], y[a])[0]
        pr = lambda h: (round(float((h & y).sum() / h.sum()), 3) if h.sum() else None, round(float((h & y).sum() / y.sum()), 3))
        (P, R), (aP, aR) = pr(hit), pr(t == cat)
        return dict(precision=P, recall=R, argmaxPrecision=aP, argmaxRecall=aR, pos=int(y.sum()), neg=int((~y).sum()))

    strip = lambda res: {c: {k: v for k, v in r.items() if k not in ('model', 'stats', 'names')} for c, r in res.items()}
    out = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'target': heads.TARGET,
           'note': 'train + Surge train + calibration, grouped 5-fold out-of-fold; test never read',
           'clipsScored': len(heads.DEV), 'devClipsWithoutTeacherScore': dropped,
           'teachers': {n: r for n, (r, _) in TEACHERS.items()}, 'results': {}}
    out['results']['clapRepeat'] = strip(heads.run_set(['clapRepeat'], cats=CATS))
    for n in TEACHERS:
        score, top = mapped(n)
        out['results'][f'{n} alone'] = {c: teacher_alone(score[c], top, c) for c in CATS}
        out['results'][f'{n} alone, drum clips only'] = {c: teacher_alone(score[c], top, c, True) for c in CATS}
        out['results'][f'clapRepeat+{n}'] = strip(heads.run_set(['clapRepeat', n], cats=CATS))
    print(json.dumps(out, indent=1))
    for cat in CATS:
        row = ' | '.join(f"{k} {v[cat]['precision']}/{v[cat]['recall']}" + (f" argmax {v[cat]['argmaxPrecision']}/{v[cat]['argmaxRecall']}" if 'argmaxRecall' in v[cat] else '') for k, v in out['results'].items() if cat in v)
        print(f'{cat:12s} {row}', file=sys.stderr)

if MODE == 'embed': embed(sys.argv[2], *map(int, sys.argv[3:5]))
elif MODE == 'compare': compare()
