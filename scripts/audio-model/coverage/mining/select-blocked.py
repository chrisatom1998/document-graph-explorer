"""Pick train-only Freesound mirror clips for the blocked tags from score-blocked.py's output. Runs in the container: it
reads private held-out inputs that never leave it. No audio.

python3 -I select-blocked.py <score dir> <heldout config.json> <in-training ids.txt> <test-ids-local.json> <out dir>
  <score dir>: score-blocked.py output (mirror.npz, mirror-b.npz, run9.npz, classes.json, mirror-meta.csv.gz).
  <test-ids-local.json>: {'ids': Freesound ids named in any local test/judge file or the test-leak audit list,
    'users': their uploaders, 'same_uploader_ids': ids whose uploader has a test clip}. Uploaders of all three are dropped.

Votes per (clip, tag):
  words  an alias of the tag in the clip's Freesound title or tags (WORDS below).
  clap   CLAP text-prompt score: the tag's rank among all prompt classes (targets + DISTRACT in score-blocked.py). The
         synth-bass family competes as one group, so 'reese bass' ranking under 'wobble bass' still counts as a bass synth.
  ced    the tag's supporting AudioSet class (SUPPORT) >= CED_MIN.
Tiers (best first):
  words+clap   words and the tag's family ranks in the top CLAP_TOP (3) classes.
  clap+ced     no words; the tag itself ranks first with margin >= MARGIN over the best non-family class, and ced agrees.
               OFF by default (CLAP_ONLY=1 turns it on): on labelled round 10 training clips CLAP's top-1 pick is right only
               1-20% of the time for these tags at any margin, so CLAP never adds a clip on its own.
  words+ced    words, CLAP rank <= CLAP_LOOSE (8) and ced agrees (catches clips CLAP half-hears).
Caps: PER_UPLOADER clips per uploader per tag, PER_TAG per tag. Writes <out>/train-list.csv (stage_mined.py columns),
per-tag.csv and candidates-detail.csv.
"""
import csv, gzip, json, os, re, sys
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import heldout  # noqa: E402

CLAP_TOP = int(os.environ.get('CLAP_TOP', '3')); CLAP_LOOSE = int(os.environ.get('CLAP_LOOSE', '8'))
CLAP_ONLY = os.environ.get('CLAP_ONLY', '') == '1'
MARGIN = float(os.environ.get('MARGIN', '0.02')); CED_MIN = float(os.environ.get('CED_MIN', '0.2'))
PER_UPLOADER = int(os.environ.get('PER_UPLOADER', '25')); PER_TAG = int(os.environ.get('PER_TAG', '800'))
BASS = ['synth bass', 'reese bass', '808 bass', 'sub bass', 'wobble bass', 'acid bass', 'bass growl', 'foghorn bass']
W = r'(?<![a-z0-9])'; E = r'(?![a-z0-9])'
WORDS = {
    'mandolin': [r'mandolin[aeo]?s?', r'mandolino', r'bandolim'],
    'bongo': [r'bongos?', r'bongo[- ]drums?'],
    'oboe': [r'oboes?', r'hautbois', r'oboist'],
    'synth bass': [r'synth[- ]?bass(es|line)?', r'bass[- ]?synth', r'moog[- ]?bass', r'analog(ue)?[- ]bass', r'synth[- ]bassline', r'minimoog'],
    'reese bass': [r'reese', r'neuro[- ]?(funk|bass)'],
    '808 bass': [r'808[- ]?(bass|sub|boom|kick)', r'tr[- ]?808', r'808s?'],
    'sub bass': [r'sub[- ]?bass(es)?', r'subby'],
    'wobble bass': [r'wobble[- ]?bass', r'wobbles?', r'wubs?', r'dubstep[- ]bass'],
    'acid bass': [r'acid[- ]?(bass|line|synth)', r'tb[- ]?303', r'303'],
    'bass growl': [r'growl[- ]?bass', r'bass[- ]?growl', r'growls?'],
    'foghorn bass': [r'foghorn[- ]?bass', r'braams?', r'inception[- ]horn'],
}
# 'growl'/'303'/'808'/'wobble' alone are ambiguous (animals, addresses, kicks): they count only beside a music word
NEEDS_MUSIC = {'bass growl': r'growls?', 'acid bass': r'303', '808 bass': r'808s?', 'wobble bass': r'wobbles?|wubs?'}
MUSIC = re.compile(W + r'(bass|synth\w*|dubstep|edm|music|loop|trap|hip[- ]?hop|beat|techno|house|dnb|drum[- ]?and[- ]?bass|electronic|serum|massive)' + E)
# bare 'growl' / '808' also name monster growls and 808 kicks: they need a bass word, not just any music word
STRICT = {'bass growl': re.compile(W + r'(bass|dubstep|riddim|brostep)' + E), '808 bass': re.compile(W + r'(bass|sub|subbass|808bass)' + E)}
SUPPORT = {'mandolin': ['Mandolin', 'Plucked string instrument'], 'bongo': ['Drum', 'Percussion', 'Tabla'],
           'oboe': ['Wind instrument, woodwind instrument', 'Clarinet', 'Flute']}
for t in BASS: SUPPORT[t] = ['Synthesizer', 'Electronic music', 'Dubstep', 'Drum and bass']
LIC = {0: 'CC0', 1: 'BY4', 2: 'BY3', 3: 'NC3', 4: 'NC4'}


def family(t):
    return BASS if t in BASS else [t]


def load(d, s):
    p = os.path.join(d, f'{s}.npz')
    return dict(np.load(p, allow_pickle=True)) if os.path.exists(p) else None


def ranks(cos, classes, tag):
    """rank (0 = first) of the tag's family best score among every class outside the family, and margin over that best."""
    fam = [classes.index(t) for t in family(tag)]; other = [i for i in range(len(classes)) if i not in fam]
    fbest = cos[:, fam].max(1); obest = cos[:, other].max(1)
    rank = (cos[:, other] > fbest[:, None]).sum(1)
    own = cos[:, classes.index(tag)]
    return rank, own - obest, (own >= cos[:, fam].max(1))   # rank vs others, margin, tag is its family's best


def main():
    sd, cfg, intrain_f, test_f, out = sys.argv[1:6]; os.makedirs(out, exist_ok=True)
    C = json.load(open(os.path.join(sd, 'classes.json'))); classes, ced_names = C['classes'], C['ced']
    tags = list(C['targets'])
    rx = {t: re.compile('|'.join(W + p + E for p in ps)) for t, ps in WORDS.items()}
    amb = {t: re.compile(W + '(' + p + ')' + E) for t, p in NEEDS_MUSIC.items()}
    meta = {}
    with gzip.open(os.path.join(sd, 'mirror-meta.csv.gz'), 'rt') as g:
        for r in csv.DictReader(g): meta[int(r['freesound_id'])] = r
    print(f'mirror meta: {len(meta)}', flush=True)
    H = heldout.HeldOut(cfg); intrain = {int(x) for x in open(intrain_f).read().split()}
    T = json.load(open(test_f)); test_ids = set(T['ids']) | set(T['same_uploader_ids'])
    test_users = {u.casefold() for u in T['users']} | {meta[i]['username'].casefold() for i in test_ids if i in meta}
    print(f'test ids {len(test_ids)}, test uploaders {len(test_users)}', flush=True)

    def words(fid, t):
        m = meta.get(fid)
        if not m: return None
        s = (m['title'] + ' ' + m['tags']).lower().replace('_', ' ')
        hit = rx[t].search(s)
        if not hit: return None
        if t in amb and amb[t].fullmatch(hit.group(0)) and not (STRICT[t] if t in STRICT else MUSIC).search(s): return None
        if t == 'bongo' and re.search(W + r'bongo(cat|s? cat)' + E, s): return None
        return hit.group(0)


    rows, why = [], defaultdict(Counter)
    for s in ('mirror', 'mirror-b'):
        z = load(sd, s)
        if z is None: continue
        ids = np.array([int(x) for x in z['id']]); cos = z['cos'].astype(np.float32); ced = z['ced'].astype(np.float32)
        for t in tags:
            rk, mg, best = ranks(cos, classes, t)
            sup = ced[:, [ced_names.index(c) for c in SUPPORT[t]]].max(1)
            for i in np.nonzero((rk < CLAP_LOOSE) | (sup >= CED_MIN) if CLAP_ONLY else (rk < CLAP_LOOSE))[0]:
                fid = ids[i]; w = words(fid, t)
                if w and rk[i] < CLAP_TOP: tier = 'words+clap'
                elif CLAP_ONLY and not w and rk[i] == 0 and mg[i] >= MARGIN and best[i] and sup[i] >= CED_MIN: tier = 'clap+ced'
                elif w and rk[i] < CLAP_LOOSE and sup[i] >= CED_MIN: tier = 'words+ced'
                else: continue
                u = str(z['username'][i]) or (meta.get(fid) or {}).get('username', '')
                if fid in test_ids: why[t]['named in a test file / leak audit'] += 1; continue
                if u.casefold() in test_users: why[t]['uploader has a test clip'] += 1; continue
                r = H.why(fid, u, t)
                if r: why[t][r] += 1; continue
                if fid in intrain: why[t]['already in training'] += 1; continue
                lic = LIC.get(int(z['license'][i]), (meta.get(fid) or {}).get('licence', '?'))
                rows.append({'tag': t, 'freesound_id': int(fid), 'username': u, 'licence': lic, 'tier': tier, 'rank': int(rk[i]),
                             'score': round(float(cos[i, classes.index(t)]), 4), 'margin': round(float(mg[i]), 4), 'ced': round(float(sup[i]), 3),
                             'words': w or '', 'title': (meta.get(fid) or {}).get('title', '')[:80]})
    order = {'words+clap': 0, 'clap+ced': 1, 'words+ced': 2}
    rows.sort(key=lambda r: (r['tag'], order[r['tier']], -r['margin']))
    kept, per_u, per_t, seen = [], Counter(), Counter(), set()
    for r in rows:
        k = (r['tag'], r['freesound_id'])
        if k in seen: continue
        seen.add(k)
        if per_u[(r['tag'], r['username'].casefold())] >= PER_UPLOADER: why[r['tag']]['per-uploader cap'] += 1; continue
        if per_t[r['tag']] >= PER_TAG: why[r['tag']]['per-tag cap'] += 1; continue
        per_u[(r['tag'], r['username'].casefold())] += 1; per_t[r['tag']] += 1; kept.append(r)
    with open(os.path.join(out, 'candidates-detail.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, list(kept[0])); w.writeheader(); w.writerows(kept)
    with open(os.path.join(out, 'train-list.csv'), 'w', newline='') as f:   # stage_mined.py columns
        w = csv.writer(f); w.writerow(['tag', 'freesound_id', 'username', 'licence', 'route', 'score', 'evidence'])
        for r in kept:
            w.writerow([r['tag'], r['freesound_id'], r['username'], r['licence'], f"blocked-{r['tier']}", r['score'],
                        f"mine-blocked v1 {r['tier']}: clap rank {r['rank']} margin {r['margin']} ced {r['ced']}" + (f" words '{r['words']}'" if r['words'] else '')])
    with open(os.path.join(out, 'per-tag.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['tag', 'kept', 'words+clap', 'clap+ced', 'words+ced', 'uploaders', 'open_licence', 'dropped'])
        for t in tags:
            k = [r for r in kept if r['tag'] == t]; c = Counter(r['tier'] for r in k)
            w.writerow([t, len(k), c['words+clap'], c['clap+ced'], c['words+ced'], len({r['username'] for r in k}),
                        sum(r['licence'] in ('CC0', 'BY4', 'BY3') for r in k), json.dumps(dict(why[t].most_common()))])
    print(open(os.path.join(out, 'per-tag.csv')).read())


if __name__ == '__main__':
    main()
