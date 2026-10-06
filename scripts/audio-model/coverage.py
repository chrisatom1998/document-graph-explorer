"""Every app sound tag (src/audio/djCatalog.json) against the tagger's outputs: which output can show it, how many
training examples taught it, and its validation precision/recall. Tags with no output stay on CLAP zero-shot.

Usage: python3 scripts/audio-model/coverage.py <run-dir> name=<prep-dir>...   (the same pairs as calibrate.py)
Writes <run-dir>/coverage.json and coverage.md. A tag is flagged low-data below 100 training positives.
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import train  # noqa: E402
FILES = {'openmic': ('train-mel.npy', 'train.json'), 'jamendo': ('jamendo-mel.npy', 'jamendo.json'), 'soundcloud': ('soundcloud-mel.npy', 'soundcloud.json'),
         'fsd50k': ('fsd50k-mel.npy', 'fsd50k.json'), 'nsynth': ('nsynth-mel.npy', 'nsynth.json')}

# OpenMIC / Jamendo outputs that name an app tag (the 'cat:' outputs name theirs directly).
SAME = {'accordion': 'accordion', 'banjo': 'banjo', 'cello': 'cello', 'clarinet': 'clarinet', 'cymbals': 'cymbal', 'drums': 'drums', 'flute': 'flute',
        'guitar': 'guitar', 'mallet_percussion': 'mallet instrument', 'mandolin': 'mandolin', 'organ': 'organ', 'piano': 'piano', 'saxophone': 'saxophone',
        'synthesizer': 'synthesizer', 'trombone': 'trombone', 'trumpet': 'trumpet', 'ukulele': 'ukulele', 'violin': 'violin / fiddle', 'voice': 'voice',
        'bass': 'bass guitar',
        'jamendo:accordion': 'accordion', 'jamendo:acousticguitar': 'acoustic guitar', 'jamendo:classicalguitar': 'acoustic guitar',
        'jamendo:acousticbassguitar': 'bass guitar', 'jamendo:bell': 'bell', 'jamendo:bongo': 'bongo', 'jamendo:cello': 'cello', 'jamendo:clarinet': 'clarinet',
        'jamendo:doublebass': 'double bass', 'jamendo:drums': 'drums', 'jamendo:electricguitar': 'electric guitar', 'jamendo:electricpiano': 'electric piano',
        'jamendo:rhodes': 'electric piano', 'jamendo:flute': 'flute', 'jamendo:guitar': 'guitar', 'jamendo:harmonica': 'harmonica', 'jamendo:harp': 'harp',
        'jamendo:horn': 'horn', 'jamendo:oboe': 'oboe', 'jamendo:organ': 'organ', 'jamendo:pipeorgan': 'organ', 'jamendo:pad': 'atmospheric pad',
        'jamendo:percussion': 'percussion', 'jamendo:piano': 'piano', 'jamendo:saxophone': 'saxophone', 'jamendo:strings': 'strings',
        'jamendo:synthesizer': 'synthesizer', 'jamendo:trombone': 'trombone', 'jamendo:trumpet': 'trumpet', 'jamendo:viola': 'viola',
        'jamendo:violin': 'violin / fiddle', 'jamendo:voice': 'voice'}

def tag_of(c): return c[4:] if c.startswith('cat:') else SAME.get(c)

def main():
    run, *pairs = sys.argv[1:]
    preps = dict(p.split('=', 1) for p in pairs)
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    catalog = json.load(open(os.path.join(root, 'src/audio/djCatalog.json')))['categories']
    th = json.load(open(os.path.join(run, 'thresholds.json'))); log = json.load(open(os.path.join(run, 'log.json')))
    pos = np.zeros(len(train.CLASSES), int)
    for name, d in preps.items():
        mel, js = FILES[name]; items = json.load(open(os.path.join(d, js)))['items']
        val = set(log['val'].get(name, []))
        src = train.load_source(name, os.path.join(d, mel), [it for it in items if it['id'] not in val], 1.0)
        pos += ((src['y'] == 1) & (src['w'] > 0)).sum(0)
    rows = []
    for c in catalog:
        outs = []
        for j, o in enumerate(train.CLASSES):
            if tag_of(o) != c['label']: continue
            t = th.get(o, {}); v = t.get('val', {})
            outs.append({'output': o, 'trainPositives': int(pos[j]), 'enabled': bool(t.get('enabled')), 'valPrecision': v.get('precision'),
                         'valRecall': v.get('recall'), 'precisionIsLowerBound': bool(t.get('precisionIsLowerBound'))})
        live = [o for o in outs if o['enabled']]
        best = max(live, key=lambda o: min(o['valPrecision'], o['valRecall'])) if live else None
        rows.append({'label': c['label'], 'group': c['group'], 'outputs': outs, 'best': best and best['output'],
                     'trainPositives': max([o['trainPositives'] for o in outs], default=0),
                     'status': 'trained' if best else ('trained, untested' if outs else 'CLAP fallback (no training data)'),
                     'lowData': bool(outs) and max(o['trainPositives'] for o in outs) < 100})
    json.dump(rows, open(os.path.join(run, 'coverage.json'), 'w'), indent=1)
    with open(os.path.join(run, 'coverage.md'), 'w') as f:
        n = lambda s: sum(r['status'] == s for r in rows)
        f.write(f"# Tagger coverage of the app's {len(rows)} sound tags\n\n{n('trained')} trained and tested, {n('trained, untested')} trained but too few "
                f"validation examples to test, {n('CLAP fallback (no training data)')} on the CLAP fallback; {sum(r['lowData'] for r in rows)} flagged low-data "
                "(under 100 training positives).\n\n| Tag | Group | Output | Training positives | Val precision | Val recall | Status |\n|---|---|---|---|---|---|---|\n")
        for r in sorted(rows, key=lambda r: (r['status'], r['group'], r['label'])):
            b = next((o for o in r['outputs'] if o['output'] == r['best']), None)
            f.write(f"| {r['label']} | {r['group']} | {r['best'] or '-'} | {r['trainPositives'] or '-'} | "
                    f"{b['valPrecision'] if b else '-'}{'*' if b and b['precisionIsLowerBound'] else ''} | {b['valRecall'] if b else '-'} | "
                    f"{r['status']}{' (low data)' if r['lowData'] else ''} |\n")
        f.write('\n\\* lower bound: uploader tags list only some instruments, so some "false" detections may be right.\n')
    print(open(os.path.join(run, 'coverage.md')).read().split('\n')[2])

if __name__ == '__main__':
    main()
