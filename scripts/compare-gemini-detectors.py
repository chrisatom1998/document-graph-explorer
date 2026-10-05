"""Compares Gemini's answers (gemini.json) with the app's trained detectors (detectors.json, from
src/dev/classifyDjAudio.ts) on the DJ test set, and writes queue.json: the clips a person should
check first, because the two disagree. Also prints how often each detector agrees with Gemini.
Gemini is a first pass, not the answer key; only human labels (labels.json) are.
Usage: compare-gemini-detectors.py <test set dir> [gemini answers file, default gemini.json]"""
import json, os, sys, collections
ROOT = sys.argv[1]; ANSWERS = sys.argv[2] if len(sys.argv) > 2 else 'gemini.json'
# Trained detector tags -> the listening page's "what it is" choice they imply.
FAMILY = {'drum hit': ['percussion hit', 'kick', 'snare', 'tom', 'crash cymbal', 'ride cymbal', 'open hi-hat', 'finger snap', 'shaker', 'cowbell'],
          'drum loop': ['drum loop', 'percussion loop', 'top loop', 'hi-hat loop', 'drum fill'],
          'vocal': ['voice', 'vocal chant', 'choir', 'vocal ad-lib', 'beatbox', 'vocal laugh', 'vocal gasp'],
          'fx': ['sound effect', 'whoosh', 'reverse effect', 'vinyl scratch'], 'texture': ['ambient drone', 'crowd ambience'],
          'bass': ['sub bass'], 'synth': ['synth arpeggio']}
TAG_FAMILY = {t: f for f, ts in FAMILY.items() for t in ts}
INSTRUMENTS = ['piano', 'organ', 'strings', 'electric guitar', 'drums', 'mallet instrument', 'harp', 'harmonica', 'accordion', 'gong', 'tabla', 'trumpet']
GEMINI_INSTRUMENT = {'trumpet': 'brass'}                      # the page offers "brass", not trumpet

clips = [c['id'] for c in json.load(open(f'{ROOT}/clips.json'))['clips']]
gem = json.load(open(f'{ROOT}/{ANSWERS}')); human = json.load(open(f'{ROOT}/labels.json')) if os.path.exists(f'{ROOT}/labels.json') else {}
det = {os.path.basename(r['file'])[:-4]: {t['label'] for t in r['tags'] if t['model'].startswith('Trained')}
       for r in json.load(open(f'{ROOT}/detectors.json'))['results']}

rows, agree = [], collections.defaultdict(lambda: [0, 0, 0])      # per detector tag: [both, detector only, gemini only]
for cid in clips:
    g, tags = gem.get(cid), det.get(cid, set())
    if not g: continue
    fams = {TAG_FAMILY[t] for t in tags if t in TAG_FAMILY}
    for f in FAMILY:
        said, heard = f in fams, g['family'] == f
        if said or heard: agree[f][0 if said and heard else 1 if said else 2] += 1
    for inst in INSTRUMENTS:
        said, heard = inst in tags, GEMINI_INSTRUMENT.get(inst, inst) in g['instruments']
        if said or heard: agree[inst][0 if said and heard else 1 if said else 2] += 1
    # Why a person should listen: what each side said, worst first.
    why = []
    if g['family'] != 'unsure' and fams and g['family'] not in fams: why.append(f"Gemini: {g['family']}, detectors: {', '.join(sorted(fams))}")
    if not fams: why.append(f"detectors silent, Gemini: {g['family']}")
    inst_mismatch = [i for i in INSTRUMENTS if (i in tags) != (GEMINI_INSTRUMENT.get(i, i) in g['instruments'])]
    if inst_mismatch: why.append('instruments differ: ' + ', '.join(inst_mismatch))
    rank = 0 if why and not why[0].startswith('detectors silent') else 1 if inst_mismatch else 2 if why else 3
    rows.append({'id': cid, 'rank': rank, 'why': why, 'humanDone': cid in human})

print(f"{'sound':<20}{'both':>6}{'detector only':>15}{'Gemini only':>13}{'agree':>8}")
for k, (b, d, g) in sorted(agree.items(), key=lambda x: -sum(x[1])):
    print(f"{k:<20}{b:>6}{d:>15}{g:>13}{b / (b + d + g):>8.0%}")
todo = [r for r in rows if not r['humanDone']]
order = sorted(todo, key=lambda r: r['rank'])
counts = collections.Counter(r['rank'] for r in todo)
print(f"\nto check: {counts[0]} family disagreements, {counts[1]} instrument-only, {counts[2]} detectors silent, {counts[3]} agree")
json.dump({'kind': 'check-queue-v1', 'order': [r['id'] for r in order], 'why': {r['id']: r['why'] for r in order},
           'mustCheck': counts[0] + counts[1]}, open(f'{ROOT}/queue.json', 'w'), indent=1)
