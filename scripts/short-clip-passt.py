"""Would a PaSST fingerprint help the short-clip bass-hit head?

Features come from scripts/embed-passt.py (frozen OpenMIC PaSST backbone, 768 numbers, first 10 s at 32 kHz)
run on the same development clips as scripts/short-clip-clap-general.mjs; the frozen test split is never read.
Same uploader/preset/participant-grouped 5-fold selection as scripts/train-short-clip-heads.py, so numbers are
comparable with development-selection.json.

Feature sets compared on every category:
  clapRepeat         today's shipped set (re-run here as the baseline)
  passt              PaSST alone
  clapRepeat+passt   both fingerprints

Decision rule, fixed 2026-10-05 before results were read: add PaSST to the bass-hit head only if
clapRepeat+passt keeps bass-hit precision and recall >= 0.70 and raises bass-hit F1 by at least 0.03
over clapRepeat. PaSST costs a ~340 MB checkpoint (85M parameters) and a second model pass per clip.

Usage: <venv>/python scripts/short-clip-passt.py > docs/evaluations/short-clips-2026-10-04/passt.json
       <venv>/python scripts/short-clip-passt.py export   -> public/sound-model/short-clip-passt.json (bass-hit head only)
"""
import glob, importlib.util, json, os, sys, datetime
import numpy as np

W = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips'
ROOT = os.path.join(os.path.dirname(__file__), '..')
CAT, MIN_GAIN = 'role:bass hit', 0.03
EXPORT = sys.argv[1:] == ['export']
# The browser export of the same frozen backbone (artifacts/astra90/experiments/export_passt_features.py); features match passt-*.jsonl.
PASST_MODEL = '79142146b9b56a2c3c4fb14f5585f28d66ecd756aaefad6f89ff8eb50b820cd9'

spec = importlib.util.spec_from_file_location('heads', f'{ROOT}/scripts/train-short-clip-heads.py')
sys.argv = [sys.argv[0], 'import-only']; heads = importlib.util.module_from_spec(spec); spec.loader.exec_module(heads)
passt = {r['id']: r['embedding'] for f in glob.glob(f'{W}/passt-*.jsonl') for r in map(json.loads, open(f))}
keep = [k for k, i in enumerate(heads.DEV) if i['id'] in passt]
dropped = len(heads.DEV) - len(keep)
heads.DEV = [heads.DEV[k] for k in keep]; heads.DEV_LAB = [heads.DEV_LAB[k] for k in keep]; heads.DEV_GROUPS = heads.DEV_GROUPS[keep]
base_block = heads.block
heads.block = lambda items, name: heads.l2(np.array([passt[i['id']] for i in items])) if name == 'passt' else base_block(items, name)

if EXPORT:
    r = heads.run_set(['clapRepeat', 'passt'], cats=[CAT])[CAT]
    assert r['precision'] >= heads.TARGET and r['recall'] >= heads.TARGET
    model = {'version': 1, 'kind': 'short-clip-heads', 'revision': f'short-clip-{datetime.date.today().isoformat()}-clapRepeat+passt',
             'clapEncoder': 'Xenova/larger_clap_music_and_speech@e9fd5ac1dbf3280936a7fc3ec8a020453ff184db', 'passtModel': PASST_MODEL,
             'eventFeatures': 'event-shape-v1', 'blocks': ['clapRepeat', 'passt'], 'maxSeconds': 2.25,
             'mean': [round(float(v), 6) for v in r['stats'][0]], 'std': [round(float(v), 6) for v in r['stats'][1]],
             'heads': [{'group': 'production', 'label': 'bass hit', 'weights': [round(float(w), 6) for w in r['model'].coef_[0]],
                        'bias': round(float(r['model'].intercept_[0]), 6), 'threshold': round(max(.5, r['threshold']), 4)}]}
    json.dump(model, open(f'{ROOT}/public/sound-model/short-clip-passt.json', 'w'), separators=(',', ':'))
    print({k: r[k] for k in ('C', 'threshold', 'precision', 'recall', 'f1', 'pos')}, file=sys.stderr); sys.exit()

SETS = {'clapRepeat': ['clapRepeat'], 'passt': ['passt'], 'clapRepeat+passt': ['clapRepeat', 'passt']}
strip = lambda res: {c: {k: v for k, v in r.items() if k not in ('model', 'stats', 'names')} for c, r in res.items()}
results = {name: strip(heads.run_set(names)) for name, names in SETS.items()}

passes = lambda r: r['precision'] >= heads.TARGET and r['recall'] >= heads.TARGET
base, both = results['clapRepeat'][CAT], results['clapRepeat+passt'][CAT]
gain = round(both['f1'] - base['f1'], 3)
print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'target': heads.TARGET,
                  'model': 'PaSST-S OpenMIC checkpoint openmic-passt-s-f128-10sec-p16-s10-ap.85.pt, frozen backbone, 768-d features',
                  'note': 'train + Surge train + calibration, grouped 5-fold out-of-fold; test never read',
                  'clipsScored': len(heads.DEV), 'devClipsWithoutPasstFeatures': dropped,
                  'decision': {'rule': f'add PaSST to {CAT} only if clapRepeat+passt passes and F1 rises >= {MIN_GAIN}',
                               'bassHitF1Gain': gain, 'adopt': passes(both) and gain >= MIN_GAIN},
                  'results': results}, indent=1))
for c in sorted(results['clapRepeat']):
    cell = lambda name: (lambda r: f"{r['precision']:.3f}/{r['recall']:.3f} f1 {r['f1']:.3f}{' PASS' if passes(r) else ''}")(results[name][c]) if c in results[name] else '-'
    print(f"{c:22s} pos {results['clapRepeat'][c]['pos']:5d} | " + ' | '.join(f'{n} {cell(n)}' for n in SETS), file=sys.stderr)
print(f'bass hit F1 gain {gain}; adopt {passes(both) and gain >= MIN_GAIN}', file=sys.stderr)
