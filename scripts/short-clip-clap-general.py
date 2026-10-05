"""Would a second CLAP fingerprint (laion/larger_clap_general) help the short-clip heads?

Features come from scripts/short-clip-clap-general.mjs (clapGeneral: computed exactly like clapRepeat, other weights).
Development data only, with the same uploader/preset/participant-grouped 5-fold selection as
scripts/train-short-clip-heads.py, so numbers are comparable with development-selection.json. Test is never read.

Feature sets compared on every category:
  clapRepeat              today's selected set (re-run here as the baseline)
  clapGeneral             the general model alone (NOT a swap option: prompts and long-clip heads need the music model)
  clapRepeat+clapGeneral  both fingerprints, i.e. a second CLAP pass on short clips only

Decision rule, fixed before results were read: adopt clapGeneral as a second short-clip fingerprint only if
clapRepeat+clapGeneral makes at least 2 more categories with >= 30 positives pass both precision and recall >= 0.70,
and no category that passes today drops below target. It costs ~78 MB more download and a second CLAP pass per clip.

Usage: <venv>/python scripts/short-clip-clap-general.py > docs/evaluations/short-clips-2026-10-04/clap-general.json
"""
import glob, importlib.util, json, os, sys, datetime
import numpy as np

W = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips'
ROOT = os.path.join(os.path.dirname(__file__), '..')
MIN_POS = 30

spec = importlib.util.spec_from_file_location('heads', f'{ROOT}/scripts/train-short-clip-heads.py')
sys.argv = [sys.argv[0], 'import-only']; heads = importlib.util.module_from_spec(spec); spec.loader.exec_module(heads)
general = {r['id']: r['clapGeneral'] for f in glob.glob(f'{W}/clap-general-*.jsonl') for r in map(json.loads, open(f))}
keep = [k for k, i in enumerate(heads.DEV) if i['id'] in general]
dropped = len(heads.DEV) - len(keep)
heads.DEV = [heads.DEV[k] for k in keep]; heads.DEV_LAB = [heads.DEV_LAB[k] for k in keep]; heads.DEV_GROUPS = heads.DEV_GROUPS[keep]
base_block = heads.block
heads.block = lambda items, name: heads.l2(np.array([general[i['id']] for i in items])) if name == 'clapGeneral' else base_block(items, name)

SETS = {'clapRepeat': ['clapRepeat'], 'clapGeneral': ['clapGeneral'], 'clapRepeat+clapGeneral': ['clapRepeat', 'clapGeneral']}
strip = lambda res: {c: {k: v for k, v in r.items() if k not in ('model', 'stats', 'names')} for c, r in res.items()}
results = {name: strip(heads.run_set(names)) for name, names in SETS.items()}

passes = lambda r: r['precision'] >= heads.TARGET and r['recall'] >= heads.TARGET
base, both = results['clapRepeat'], results['clapRepeat+clapGeneral']
gained = sorted(c for c in both if c in base and base[c]['pos'] >= MIN_POS and passes(both[c]) and not passes(base[c]))
lost = sorted(c for c in both if c in base and passes(base[c]) and not passes(both[c]))
print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'target': heads.TARGET,
                  'model': 'Xenova/larger_clap_general@d78c3994912c441f0151a5cc44d86f6b7bf4c861 (upstream laion/larger_clap_general, Apache-2.0), q8 audio encoder',
                  'note': 'train + Surge train + calibration, grouped 5-fold out-of-fold; test never read',
                  'clipsScored': len(heads.DEV), 'devClipsWithoutGeneralFeatures': dropped,
                  'decision': {'rule': f'adopt only if >= 2 more categories with >= {MIN_POS} positives pass and none that pass today drop',
                               'newlyPassing': gained, 'droppedBelowTarget': lost, 'adopt': len(gained) >= 2 and not lost},
                  'results': results}, indent=1))
for c in sorted(base):
    cell = lambda name: (lambda r: f"{r['precision']:.3f}/{r['recall']:.3f} f1 {r['f1']:.3f}{' PASS' if passes(r) else ''}")(results[name][c]) if c in results[name] else '-'
    print(f"{c:22s} pos {base[c]['pos']:5d} | " + ' | '.join(f'{n} {cell(n)}' for n in SETS), file=sys.stderr)
print(f'newly passing: {gained}  dropped: {lost}', file=sys.stderr)
