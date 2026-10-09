"""Prompt list for the A/B: the app's own prompt text (public/sound-model/prompts.json, first per label) for every label
in the two test sets, and a plain template for labels the app has no prompt for. Same text for both encoders.
Usage: prompts.py <out.json>"""
import json, os, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
app = {}
for p in json.load(open(f'{ROOT}/public/sound-model/prompts.json')): app.setdefault(p['label'], p['prompt'])
dj = {l for c in json.load(open(f'{ROOT}/docs/evaluations/dj-effects-2026-10-06/clips.json'))['clips'] for l in c['labels']}
short = {r['label'] for i in json.load(open(f'{ROOT}/docs/evaluations/short-clips-2026-10-04/manifest.json'))['items'] for r in i['reviews']}
out = [{'label': l, 'prompt': app.get(l, f'The sound of {l}.'), 'fromApp': l in app} for l in sorted(dj | short)]
json.dump(out, open(sys.argv[1], 'w'), indent=1); print(len(out), 'prompts,', sum(p['fromApp'] for p in out), 'from the app')
