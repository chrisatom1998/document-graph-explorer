#!/usr/bin/env python3
"""Precision, recall and F1 for the app's sound tags on NSynth test notes.

Reads the JSONL written by score-nsynth.mjs (CLAP q8 embeddings and tagger scores).
The "after" column applies the same short-recording rule as learnedDjScores:
electric guitar is kept only when its probability is strictly above acoustic guitar.
No cutoff is fitted here. NSynth test instruments are not in the training split.

Usage: python3 scripts/sound-id-eval/report.py .cache/nsynth-scores.jsonl
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learned_store import load_learned

ROOT = Path(__file__).resolve().parents[2]
rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
learned = load_learned(ROOT / 'public/sound-model/learned.json')
policy = json.loads((ROOT / 'src/audio/taggerPolicy.json').read_text())
heads = {h['label']: h for h in learned['heads'] if h['group'] == 'source'}
pol = {t['label']: t for t in policy['tags']}

def sigmoid(x):
    x = max(-35.0, min(35.0, x))
    return 1 / (1 + math.exp(-x))

def head_prob(row, label):
    head = heads[label]
    emb = row['embedding']
    norm = math.sqrt(sum(v * v for v in emb)) or 1.0
    logit = head['bias'] + sum(w * v for w, v in zip(head['weights'], emb)) / norm
    return sigmoid(logit)

def tagger(row, output):
    return row['tagger'].get(output, 0.0)

# Same labels the project's published NSynth table uses, plus the two guitar subtypes
# the CLAP heads show on a 4 s note. Truth is the NSynth family/source, one label per note.
TRUTH = {
    'electric guitar': lambda r: r['family'] == 'guitar' and r['source'] == 'electronic',
    'acoustic guitar': lambda r: r['family'] == 'guitar' and r['source'] == 'acoustic',
    'guitar': lambda r: r['family'] == 'guitar',
    'mallet instrument': lambda r: r['family'] == 'mallet',
    'piano': lambda r: r['instrument'].startswith('keyboard_acoustic'),
    'organ': lambda r: r['family'] == 'organ',
    'flute': lambda r: r['family'] == 'flute',
}

def app_shows(label, row, gated):
    """Shipped display on a note shorter than 10 s: one tagger window, learned heads on, one-shots off."""
    tag = pol.get(label)
    if tag and (not tag.get('minSeconds') or row['duration'] + 1e-6 >= tag['minSeconds']):
        return tagger(row, tag['output']) >= tag['threshold']
    if label not in heads:
        return False
    score = head_prob(row, label)
    if score < heads[label]['threshold']:
        return False
    if gated and label == 'electric guitar':
        return score > head_prob(row, 'acoustic guitar')
    # Between a one-shot and piano's 10 s handoff, the stored tagger score has to clear the shipped cutoff.
    if gated and label == 'piano':
        piano = pol['piano']
        return tagger(row, 'piano') >= piano['threshold']
    return True

def counts(pred, truth):
    tp = fp = fn = 0
    for row in rows:
        hit, yes = pred(row), truth(row)
        if hit and yes: tp += 1
        elif hit: fp += 1
        elif yes: fn += 1
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else 0.0
    return dict(tp=tp, fp=fp, fn=fn, pos=tp + fn, precision=precision, recall=recall, f1=f1)

def cell(m):
    p = '—' if m['precision'] is None else f"{m['precision']:.3f}"
    r = '—' if m['recall'] is None else f"{m['recall']:.3f}"
    return f"{p} / {r} / {m['f1']:.3f}"

print(f'notes {len(rows)}')
if len(rows) != 4096:
    print(f'WARNING: expected 4096 NSynth test notes, got {len(rows)}')
print(f'{"tag":20} {"pos":>5}  {"before P/R/F1":18} {"after P/R/F1":18}  fp before→after')
micro_b = dict(tp=0, fp=0, fn=0)
micro_a = dict(tp=0, fp=0, fn=0)
per = {}
for label, truth in TRUTH.items():
    before = counts(lambda row, label=label: app_shows(label, row, False), truth)
    after = counts(lambda row, label=label: app_shows(label, row, True), truth)
    per[label] = {'before': before, 'after': after}
    for bucket, m in ((micro_b, before), (micro_a, after)):
        bucket['tp'] += m['tp']; bucket['fp'] += m['fp']; bucket['fn'] += m['fn']
    print(f'{label:20} {before["pos"]:5d}  {cell(before):18} {cell(after):18}  {before["fp"]}→{after["fp"]}')

def micro(b):
    p = b['tp'] / (b['tp'] + b['fp']) if b['tp'] + b['fp'] else None
    r = b['tp'] / (b['tp'] + b['fn']) if b['tp'] + b['fn'] else None
    f1 = 2 * p * r / (p + r) if p and r else 0.0
    return p, r, f1
print('micro (7 tags)     ', ' '.join(f'{x:.3f}' if x is not None else '—' for x in micro(micro_b)), '→', ' '.join(f'{x:.3f}' if x is not None else '—' for x in micro(micro_a)))
defined = [label for label, pair in per.items() if pair['before']['precision'] and pair['before']['recall']]
print('macro F1           ', f"{sum(per[l]['before']['f1'] for l in defined)/len(defined):.3f}", '→', f"{sum(per[l]['after']['f1'] for l in defined)/len(defined):.3f}")

print('\nelectric guitar by instrument (before → after)')
by = defaultdict(list)
for row in rows:
    if row['family'] == 'guitar' and row['source'] == 'electronic':
        by[row['instrument']].append(row)
for inst, notes in sorted(by.items()):
    def on(gated, notes=notes):
        tp = sum(app_shows('electric guitar', r, gated) for r in notes)
        return tp, len(notes) - tp
    # false positives are not in this instrument; report recall only
    btp, bfn = on(False)
    atp, afn = on(True)
    print(f'  {inst}: recall {btp}/{btp+bfn} → {atp}/{atp+afn}')

out = Path(sys.argv[2]) if len(sys.argv) > 2 else None
if out:
    payload = {'notes': len(rows), 'tags': {k: {'before': v['before'], 'after': v['after']} for k, v in per.items()},
               'microBefore': micro(micro_b), 'microAfter': micro(micro_a)}
    out.write_text(json.dumps(payload, indent=1) + '\n')
    print('wrote', out)
