"""Scores Gemini answer files against expert-labelled clips (artifacts/gemini-yardstick, built from
FSD50K eval clips with a single expert label). Says how often each model gets the page's
"what it is" choice and the instruments right, so a model can be trusted (or not) as a labeller.
Usage: score-gemini-yardstick.py <yardstick dir>"""
import json, sys, glob, os, collections
ROOT = sys.argv[1]; expected = json.load(open(f'{ROOT}/expected.json'))
# Pass rule, fixed before any pro/omni run: 40/48 overall AND 18/21 (the same 83%) on the instrument clips,
# because confirming instrument tags is what a labeller would be used for.
INSTRUMENT_CLIPS = {'piano', 'electric guitar', 'acoustic guitar', 'strings', 'organ', 'trumpet', 'bass guitar'}
for path in sorted(glob.glob(f'{ROOT}/gemini*.json')):
    answers = json.load(open(path)); fam = inst = n = ifam = iclips = 0; wrong = collections.Counter()
    for cid, e in expected.items():
        a = answers.get(cid)
        if not a: continue
        n += 1; ok = a['family'] == e['family']; fam += ok
        if e['label'] in INSTRUMENT_CLIPS: iclips += 1; ifam += ok and set(e['instruments']) <= set(a['instruments'])
        if not ok: wrong[f"{e['label']} -> {a['family']}"] += 1
        # Instruments count as right when every expected one is named (or "none" both ways); whoosh has no instrument answer.
        inst += not e['instruments'] or set(e['instruments']) <= set(a['instruments'])
    print(f"\n{os.path.basename(path)}: {n} clips   what-it-is right {fam}/{n} ({fam / max(n, 1):.0%})   instruments right {inst}/{n} ({inst / max(n, 1):.0%})")
    passes = fam >= 40 and ifam >= 18
    print(f"   instrument clips fully right (what-it-is AND instrument) {ifam}/{iclips}   ->  {'PASSES' if passes else 'fails'} (needs 40/48 and 18/21)")
    for k, v in wrong.most_common(8): print(f'   wrong: {k} x{v}')
