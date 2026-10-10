"""Pick the clean TRAIN-side source clips for the effect pairs (coverage idea #4) and assign each one to one effect tag.

Usage: python3 -I select_sources.py <manifest-dir> <out plan.csv> [--commercial-list c-train-list.csv]
  <manifest-dir> holds the downloaded manifests: run9/v1-audit/manifest-audited.csv and empty-tags/v1/<part>/manifest.csv.
  Only split=train rows with keep=1 are used. Every source clip is used for exactly one effect, so each dry copy appears once.

Sources (all train side): run 9 labelled sets (VocalSet, Groove MIDI, tabla, VSCO 2, Karoryfer, ESC-50, Nonspeech7k,
licensed-pilot CC0), empty-tags/v1 (CSD choir, NSynth train organ/bass, SASS-E pans ctenor-01/03, Iowa + VSCO rolls), and the
round 10 commercial train list (SampleRadar, Philharmonia, BBC; private bucket cmjatom/dge-commercial-train). Never used:
empty-tags/v1 derived (code-made), egfx (round 13 adds EGFxSet), any clip whose own tags already name an effect, any
commercial pack on the test side of datasets/commercial-split/packs.csv, and any Iowa file in iowa-judge-exclude.json.
"""
import argparse, csv, hashlib, json, os, re, sys
from collections import Counter, defaultdict

h = lambda *p: int(hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()[:12], 16)
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts/audio-model'))
from labelmap import CAT  # noqa: E402
from labels_extra import EXTRA_CAT  # noqa: E402
KNOWN = set(CAT) | set(EXTRA_CAT)

EFFECT_TAGS = ['reverse effect', 'reversed vocal', 'record stop', 'stutter effect', 'reverberant', 'echoing', 'distorted',
               'chorused', 'flanged', 'bitcrushed', 'filtered', 'filter sweep']
# a source whose own tags name any of these already carries processing, so it is not a clean dry copy
EFFECTISH = set(EFFECT_TAGS) | {'glitch effect', 'saturated', 'vocoder vocal', 'riser', 'downlifter', 'whoosh', 'reverse cymbal',
                                'reverse impact', 'vinyl scratch', 'wobbling', 'noise sweep', 'trance gate', 'pulsing', 'chops',
                                'vocal chops', 'pitched vocal', 'sub drop', 'laser', 'impact', 'static noise', 'vinyl crackle'}
TARGET = {t: 500 for t in EFFECT_TAGS}
TARGET.update({'reverse effect': 600, 'reverberant': 600, 'distorted': 600, 'echoing': 550})
# share of each tag's pairs taken from each kind of source
MIX = {
    'reverse effect': {'drums': .3, 'inst': .25, 'synth': .2, 'sfx': .15, 'loop': .1},
    'reversed vocal': {'vocal': 1.0},
    'record stop': {'loop': .45, 'drums': .1, 'synth': .15, 'vocal': .15, 'inst': .15},
    'stutter effect': {'loop': .35, 'vocal': .2, 'synth': .15, 'inst': .15, 'drums': .15},
    'reverberant': {'inst': .3, 'vocal': .2, 'drums': .2, 'synth': .15, 'sfx': .15},
    'echoing': {'drums': .25, 'vocal': .2, 'inst': .2, 'synth': .2, 'sfx': .15},
    'distorted': {'synth': .2, 'inst': .25, 'drums': .25, 'vocal': .15, 'loop': .15},
    'chorused': {'synth': .25, 'inst': .35, 'vocal': .2, 'loop': .2},
    'flanged': {'drums': .25, 'loop': .25, 'synth': .2, 'inst': .15, 'vocal': .15},
    'bitcrushed': {'drums': .25, 'loop': .2, 'synth': .2, 'vocal': .15, 'inst': .1, 'sfx': .1},
    'filtered': {'loop': .25, 'synth': .2, 'drums': .2, 'inst': .15, 'vocal': .1, 'sfx': .1},
    'filter sweep': {'loop': .35, 'synth': .25, 'drums': .15, 'inst': .1, 'sfx': .15},
}
MIN_SEC = {'record stop': 2.0, 'stutter effect': 1.5, 'filter sweep': 2.0, 'reversed vocal': .8, 'reverse effect': .3}
# tags first so an edit that needs a longer phrase gets first pick of the long clips
ORDER = ['reversed vocal', 'record stop', 'filter sweep', 'stutter effect'] + [t for t in EFFECT_TAGS if t not in
         ('record stop', 'filter sweep', 'stutter effect', 'reversed vocal')]
PER_GROUP = 12   # at most this many pairs per source group per tag, so no one singer / pack / kit dominates
PER_GROUP_TAG = {'reversed vocal': 30}   # few vocal groups (20 VocalSet singers, 4 CSD pieces, a handful of vocal packs)
DRUM_HIT = {'kick', 'snare', 'hi-hat', 'closed hi-hat', 'open hi-hat', 'tom', 'clap', 'cymbal', 'crash cymbal', 'ride cymbal', 'percussion hit', 'rimshot'}
INST = {'guitar', 'acoustic guitar', 'electric guitar', 'bass guitar', 'piano', 'electric piano', 'organ', 'bell', 'strings', 'violin / fiddle',
        'cello', 'viola', 'double bass', 'flute', 'clarinet', 'oboe', 'bassoon', 'saxophone', 'trumpet', 'trombone', 'tuba', 'horn', 'harp',
        'marimba', 'vibraphone', 'xylophone', 'glockenspiel'}


def kind_of(src, tags, sec):
    t = set(tags)
    if src in ('vocalset', 'csd'): return 'vocal'
    if src in ('gmd', 'tabla'): return 'drums' if sec < 4 else 'loop'
    if src == 'nsynth': return 'synth'
    if src in ('vsco2', 'karoryfer', 'iowa', 'VSCO-2-CE', 'sass-e', 'philharmonia'): return 'inst'
    if src in ('esc50', 'nonspeech7k') or src.startswith('pilot-'): return 'sfx'
    if src == 'bbc-sfx': return 'vocal' if t & {'voice', 'vocal shout'} else 'sfx'
    # SampleRadar
    if t & {'voice'}: return 'vocal'
    if sec >= 2 and t & {'drum loop', 'breakbeat', 'percussion loop', 'hi-hat loop', 'synth arpeggio'}: return 'loop'
    if t & DRUM_HIT or t & {'drums', 'percussion'}: return 'drums'
    if t & {'synthesizer', 'synth bass', 'synth lead', 'atmospheric pad', 'string synth', 'acid synth', 'chiptune synth', 'synth chord', 'sub bass'}:
        return 'loop' if sec >= 4 and t & {'rhythmic', 'synth arpeggio'} else 'synth'
    if t & INST: return 'inst'
    return None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('mdir'); ap.add_argument('out'); ap.add_argument('--commercial-list', default='')
    a = ap.parse_args(); rows = []
    for x in csv.DictReader(open(os.path.join(a.mdir, 'run9/v1-audit/manifest-audited.csv'))):
        if x['part'].endswith('labelled') and x['split'] == 'train' and x['keep'] == '1':
            rows.append(dict(origin='private-train', part=x['part'], file=x['file'], id=x['id'], source=x['source'], group=x['group'],
                             tags=x['tags'], licence=x['licence'], creator=x['creator'], url=x['url'], seconds=float(x['seconds'] or 0)))
    iowa_ex = json.load(open(os.path.join(REPO, 'scripts/audio-model/iowa-judge-exclude.json')))['files']
    ex_names = {f['name'].lower() for f in iowa_ex}; ex_sha = {f['sha256'] for f in iowa_ex}
    for part in ('csd', 'nsynth', 'sasse', 'urls'):
        for x in csv.DictReader(open(os.path.join(a.mdir, f'empty-tags/v1/{part}/manifest.csv'))):
            if x['split'] != 'train' or x['keep'] != '1': continue
            if x['source'] == 'iowa' and (os.path.basename(x['id']).lower() in ex_names or x['encoded_sha256'] in ex_sha): continue
            rows.append(dict(origin='private-train', part=x['part'], file=x['file'], id=x['id'], source=x['source'], group=x['group'],
                             tags=x['tags'], licence=x['licence'], creator=x['creator'], url=x['url'], seconds=float(x['seconds'] or 0)))
    if a.commercial_list:
        test_packs = {p['group'] for p in csv.DictReader(open('/mnt/project-files/datasets/commercial-split/packs.csv')) if p['split'] == 'test'}
        judge_names = {(s['pack'], os.path.basename(s['path'])) for s in csv.DictReader(open('/mnt/project-files/datasets/commercial-split/split.csv'))}
        dropped = Counter()
        for x in csv.DictReader(open(a.commercial_list)):
            pack = '/'.join(x['path'].split('/')[:2])
            if x['split'] != 'train' or pack in test_packs: dropped['test pack'] += 1; continue
            if (pack.split('/', 1)[1], x['original_name']) in judge_names: dropped['judge name'] += 1; continue
            src = 'philharmonia' if pack == 'other-packs/philharmonia-orchestra' else x['source']
            if src == 'sonniss': continue   # NO AI TRAINING clause in its EULA; keep it out of new sets
            tags = sorted({t for t in x['present_tags'].split(';') if t})
            rows.append(dict(origin='commercial-train', part='commercial-train', file=x['path'], id=f"{x['source']}:{x['path']}", source=src,
                             group=f"{pack}:{x['group']}" if src == 'bbc-sfx' else pack + ('/' + x['group'] if src == 'philharmonia' else ''),
                             tags='|'.join(tags), licence=x['licence'], creator=x['source'], url=x['origin'], seconds=float(x['duration_s'] or 0)))
        print('commercial dropped', dict(dropped))
    pool = defaultdict(list); skipped = Counter()
    for r in rows:
        tags = [t for t in r['tags'].split('|') if t]
        if set(tags) & EFFECTISH: skipped['effect in own tags'] += 1; continue
        if r['seconds'] < .25: skipped['too short'] += 1; continue
        if not set(tags) & KNOWN: skipped['no known tag'] += 1; continue   # prepare-run9.py drops a clip with no known tag
        k = kind_of(r['source'], tags, r['seconds'])
        if k is None: skipped['no kind'] += 1; continue
        r['kind'] = k; pool[k].append(r)
    print('pool by kind', {k: len(v) for k, v in pool.items()}, 'skipped', dict(skipped))
    used, plan = set(), []
    for tag in ORDER:
        n_tag = Counter()
        for kind, share in MIX[tag].items():
            want = round(TARGET[tag] * share)
            cands = [r for r in pool[kind] if r['id'] not in used and r['seconds'] >= MIN_SEC.get(tag, .25)]
            # spread over sources first, then groups: round-robin by source, hash order inside
            by_src = defaultdict(list)
            for r in sorted(cands, key=lambda r: h('fxpair', tag, r['id'])): by_src[r['source']].append(r)
            per_group, got, srcs = Counter(), 0, sorted(by_src)
            while got < want and any(by_src.values()):
                for s in srcs:
                    while by_src[s]:
                        r = by_src[s].pop(0)
                        if per_group[r['group']] >= PER_GROUP_TAG.get(tag, PER_GROUP): continue
                        per_group[r['group']] += 1; used.add(r['id']); plan.append(dict(r, effect=tag)); got += 1; break
                    if got >= want: break
            n_tag[kind] = got
        print(f'{tag}: {sum(n_tag.values())} ({dict(n_tag)})')
    cols = ['effect', 'kind', 'origin', 'part', 'file', 'id', 'source', 'group', 'tags', 'licence', 'creator', 'url', 'seconds']
    with open(a.out, 'w', newline='') as f:
        w = csv.DictWriter(f, cols, extrasaction='ignore'); w.writeheader(); w.writerows(plan)
    print('plan rows', len(plan), 'commercial', sum(r['origin'] == 'commercial-train' for r in plan))


if __name__ == '__main__':
    main()
