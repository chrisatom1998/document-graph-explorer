"""Coverage idea #2, step 2: the absent-drop and new-positive lists for train.py --absent-fix, from out-of-fold teacher scores.

python3 -I build-absent-fix.py <oof dir> <round11 features dir> <run9 manifest-audited.csv> <heldout config.json> \
    <ced-tag-map.json> <out dir>
  <oof dir>: oof-scores.py output (oof.npz, thresholds.json, val.json). Everything below reads train-side clips only; every
  cutoff is set from the out-of-fold scores of those clips (never from a held-out or judge set).

Which absences are weak (what train.py would teach at --weak 0.2), rebuilt exactly as the prep scripts do:
  run 9 / empty-tags (prepare-run9.py): T = RUN9_TAGS + every own tag of the staged set + render tags; weak = T - own - the
    look-alike absences of Freesound clips (prepare-run9.py LOOKALIKES + round12.json 'lookalikes'), which are outright.
  round 10 (prepare-round10.py): T = every present tag of the train list; weak = T - own - its listed absent_tags.
  round 12 merges count a child's parent as own.

Rules per tag (teacher vocabulary only; the threshold thr is the frozen out-of-fold argmax min(P, R) of oof-scores.py):
  drop  weak absence with out-of-fold score >= thr, when the teacher's out-of-fold min(P, R) on the tag >= DROP_Q.
        A drop only removes a negative (weight 0.2 -> 0), so it is allowed at the teacher's operating point.
  add   weak absence with out-of-fold score >= the tag's high-precision cutoff: the lowest score at which the clips scoring
        at or above it are >= ADD_P labelled positives (weak absences counted as negatives, so this is a lower bound),
        with >= 10 labelled positives above it; teacher out-of-fold min(P, R) >= ADD_Q; where the tag has an AudioSet
        mapping (ced-tag-map.json) CED-base must agree (best mapped class >= CED_MIN on the same clip); a Freesound clip
        whose uploader is held out for that tag is skipped (heldout.py); at most ADD_CAP x the tag's current positives,
        best scores first. An added positive is not also dropped.
  both  never on a clip whose own tags name a look-alike sibling of the tag (prepare-run9.py LOOKALIKES + round12.json): a
        clip labelled oboe keeps "not clarinet", since the teacher's score there is look-alike confusion, not a missed label;
        and, outside Freesound, never on a clip labelled with another single instrument (INSTRUMENTS); never on an item whose
        Freesound id is in any held-out list (heldout.py).
Writes <out dir>/absent-fix.json (train.py --absent-fix), per-tag.csv, changes.csv (item, tag, action, score; private) and
hp-cutoffs.json (each tag's ADD_P cutoff, for mining/mine-mirror.py --hp).
"""
import csv, glob, importlib.util, json, os, sys
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
AM = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, AM); sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'mining'))
from labelmap import CAT  # noqa: E402
from labels_extra import EXTRA_CAT, RUN9_TAGS  # noqa: E402
import heldout  # noqa: E402


def mod(name, path):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


p9 = mod('p9', os.path.join(AM, 'prepare-run9.py'))
oofm = mod('oofm', os.path.join(HERE, 'oof-scores.py'))
R12 = json.load(open(os.path.join(AM, 'round12', 'round12.json')))
DROP_Q, ADD_Q, ADD_P, ADD_CAP, CED_MIN = (float(os.environ.get(k, v)) for k, v in
                                          (('DROP_Q', '0.3'), ('ADD_Q', '0.5'), ('ADD_P', '0.9'), ('ADD_CAP', '0.5'), ('CED_MIN', '0.3')))


# Single-instrument tags. Outside Freesound (sample packs, Philharmonia, NSynth, VSCO, IRMAS...) a file names the one instrument
# it holds, so a clip labelled cello keeps "not clarinet" / "not string synth" even when the teacher confuses the two.
INSTRUMENTS = {'clarinet', 'oboe', 'flute', 'bassoon', 'saxophone', 'cello', 'viola', 'violin / fiddle', 'double bass', 'trumpet',
               'trombone', 'tuba', 'horn', 'harp', 'piano', 'electric piano', 'organ', 'accordion', 'acoustic guitar', 'electric guitar',
               'bass guitar', 'mandolin', 'banjo', 'sitar', 'ukulele', 'marimba', 'vibraphone', 'xylophone', 'glockenspiel',
               'string synth', 'brass synth', 'harmonica', 'kalimba', 'steel drum'}


def hp_cutoff(s, y, p_min, min_pos=10):
    """Lowest score whose at-or-above set is >= p_min labelled positives (and holds >= min_pos of them); None if none."""
    o = np.argsort(-s); tp = np.cumsum(y[o]); n = np.arange(1, len(o) + 1)
    ok = np.where((tp / n >= p_min) & (tp >= min_pos))[0]
    return float(s[o][ok.max()]) if len(ok) else None


def main():
    oofd, feat, audit, hcfg, cedmap, out = sys.argv[1:7]
    os.makedirs(out, exist_ok=True)
    z = np.load(os.path.join(oofd, 'oof.npz'))
    vocab = [str(v) for v in z['vocab']]; S = z['scores'].astype(np.float32)
    thr = json.load(open(os.path.join(oofd, 'thresholds.json'))); val = json.load(open(os.path.join(oofd, 'val.json')))
    items, kinds, sources = [str(x) for x in z['item']], [str(x) for x in z['kind']], [str(x) for x in z['source']]
    own = [set(filter(None, str(x).split('|'))) for x in z['own']]; absent = [set(filter(None, str(x).split('|'))) for x in z['absent']]
    known = set(CAT) | set(EXTRA_CAT)
    for g in R12.get('lookalikes', []):
        if g not in p9.LOOKALIKES: p9.LOOKALIKES.append(g)
    merge = R12.get('merge', {})
    render_tags = {t for k, v in p9.RENDERS.items() for t in [k] + list(v[2])}
    T = {}
    for k in ('run9', 'emptytags'):
        T[k] = (set(RUN9_TAGS) | {t for o, kk in zip(own, kinds) if kk == k for t in o} | render_tags) & known
    T['round10'] = {t for o, kk in zip(own, kinds) if kk == 'round10' for t in o} & known
    # CED mapped score per (item, tag) and the uploader of each Freesound item
    cmap = {t: v for t, v in json.load(open(cedmap))['tags'].items()}
    man = oofm.rows(feat, audit)
    ced = {}
    for d in ('run9', 'commercial', 'emptytags'):
        for f in sorted(glob.glob(os.path.join(feat, d, '*.npz'))):
            zz = np.load(f)
            P = zz['ced_probs'].astype(np.float32)
            for i, cid in enumerate(zz['id']):
                m = man.get(str(cid))
                if m: ced[m[0]] = {t: float(P[i, c].max()) for t, c in cmap.items()}
    users = {}
    for r in csv.DictReader(open(audit)):
        if r['source'] == 'freesound': users[r['id']] = r['creator']
    for m in glob.glob(os.path.join(feat, 'emptytags', 'manifests', '*.csv')):
        for r in csv.DictReader(open(m)):
            if r.get('source') == 'freesound': users[r['id']] = r['creator']
    H = heldout.HeldOut(hcfg)

    # Conservative: no change on an item whose Freesound id sits in any held-out list (run 9 re-split the keyword list by its
    # own uploader rule, so some run 9 train clips are held-out rows of the keyword list; those keep their labels untouched).
    held_item = np.array([(heldout.fs_id(it) or -1) in H._id for it in items])
    print(f'{int(held_item.sum())} train items have an id in a held-out list; left unchanged', flush=True)
    ix = {t: j for j, t in enumerate(vocab)}
    Y = np.zeros_like(S, dtype=bool); W = np.zeros_like(S, dtype=bool)   # labelled present / weak absence
    for i in range(len(items)):
        o = set(own[i]) | {merge[c] for c in own[i] if c in merge}
        sure = p9.lookalike_absent(o) if sources[i] == 'freesound' and kinds[i] != 'round10' else set()
        weak = T[kinds[i]] - o - absent[i] - sure
        for t in o:
            if t in ix: Y[i, ix[t]] = True
        for t in weak:
            if t in ix: W[i, ix[t]] = True
    siblings = defaultdict(set)
    for g in p9.LOOKALIKES:
        for t in g: siblings[t] |= set(g) - {t}
    own_m = [set(o) | {merge[c] for c in o if c in merge} for o in own]
    for i in range(len(items)):   # sample packs and datasets name the one instrument a file holds (see INSTRUMENTS)
        if sources[i] != 'freesound' and own_m[i] & INSTRUMENTS: own_m[i] = own_m[i] | {'@instrument'}
    for t in INSTRUMENTS: siblings[t] = siblings[t] | {'@instrument'}
    drop, add, rows, changes, hp = defaultdict(list), defaultdict(list), [], [], {}
    for t, j in ix.items():
        s = S[:, j]; v = val.get(t, {}); q = min(v.get('oof_p', 0), v.get('oof_r', 0))
        th = thr.get(t)
        y = Y[:, j]
        hpc = hp_cutoff(s, y, ADD_P)
        if hpc is not None: hp[t] = hpc
        cut = hpc if q >= ADD_Q else None
        nd = na = 0; why = Counter()
        sib = np.array([bool(own_m[i] & siblings.get(t, set())) for i in range(len(items))]) | held_item   # sibling labelled / held-out id
        if th is not None and q >= DROP_Q:
            cand = np.where(W[:, j] & (s >= th) & ~sib)[0]
            why['drop skipped: sibling/instrument labelled or held-out id'] = int((W[:, j] & (s >= th) & sib).sum())
        else:
            cand = np.array([], int)
        adds = []
        if cut is not None:
            for i in np.where(W[:, j] & (s >= cut) & ~sib)[0]:
                if t in cmap and ced.get(items[i], {}).get(t, 0) < CED_MIN: why['CED disagrees'] += 1; continue
                u = users.get(items[i])
                if u is not None and H.why(heldout.fs_id(items[i]) or -1, u, t): why['held-out rule'] += 1; continue
                adds.append(i)
            adds.sort(key=lambda i: -s[i])
            cap = int(ADD_CAP * y.sum())
            if len(adds) > cap: why['cap'] += len(adds) - cap; adds = adds[:cap]
        aset = set(adds)
        for i in adds:
            add[items[i]].append(t); changes.append((items[i], t, 'add', round(float(s[i]), 3))); na += 1
        for i in cand:
            if i in aset: continue
            drop[items[i]].append(t); changes.append((items[i], t, 'drop', round(float(s[i]), 3))); nd += 1
        rows.append({'tag': t, 'labelled_pos': int(y.sum()), 'weak_absences': int(W[:, j].sum()),
                     'oof_p': v.get('oof_p', ''), 'oof_r': v.get('oof_r', ''), 'threshold': round(th, 4) if th is not None else '',
                     'absences_dropped': nd, 'positives_added': na, 'add_cutoff': round(cut, 4) if cut is not None else '',
                     'ced_mapped': int(t in cmap), 'add_skipped_ced': why['CED disagrees'], 'add_skipped_heldout': why['held-out rule'],
                     'add_skipped_cap': why['cap'], 'drop_skipped_sibling': why['drop skipped: sibling/instrument labelled or held-out id']})
    for d in (drop, add):
        for k in d: d[k] = sorted(set(d[k]))
    meta = {'about': 'coverage idea #2: out-of-fold round 11 teacher (refit on run 9 + round 10 + empty-tags train clips); '
                     'train.py --absent-fix. Train-side items only; cutoffs from out-of-fold train scores only.',
            'rules': {'DROP_Q': DROP_Q, 'ADD_Q': ADD_Q, 'ADD_P': ADD_P, 'ADD_CAP': ADD_CAP, 'CED_MIN': CED_MIN},
            'drop_pairs': sum(len(v) for v in drop.values()), 'add_pairs': sum(len(v) for v in add.values())}
    json.dump({**meta, 'drop': dict(drop), 'add': dict(add)}, open(os.path.join(out, 'absent-fix.json'), 'w'))
    json.dump(hp, open(os.path.join(out, 'hp-cutoffs.json'), 'w'), indent=1)   # mining/mine-mirror.py --hp
    with open(os.path.join(out, 'per-tag.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, list(rows[0])); w.writeheader(); w.writerows(sorted(rows, key=lambda r: r['tag']))
    with open(os.path.join(out, 'changes.csv'), 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['item', 'tag', 'action', 'oof_score']); w.writerows(changes)
    print(json.dumps(meta), flush=True)


if __name__ == '__main__':
    main()
