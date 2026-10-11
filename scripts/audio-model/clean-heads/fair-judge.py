"""Judge old vs clean CLAP heads on the fresh board test sets with the board's rules, and pick each clean head's cutoff
FAIRLY (container only; test audio and ids never leave the project folder).

Usage: python3 -I fair-judge.py <emb dir> <learned-main.json> <clean heads.json> <latest.json> <out.json>

- Sets: the board's sets (fresh-tests-2026-10-11/sets/*.csv). The locked free-tag-set holdout is NOT used.
- Clip score = max over 10 s windows of sigmoid(bias + w . x/|x|), as the app's learned heads.
- Labels as the board: present (with mergedInto parents) = positive, absent = negative, else skipped.
- Pass rule as the board: every set with >= 5 positives has P >= 0.6 and R >= 0.3, at least one of them has negatives,
  and a set with < 5 positives and >= 50 negatives false-alarms on <= 1% of them. On a half, whether a set is under
  that cap is decided by its whole-set negatives (a 50-negative set split 25/25 is still capped on each half).
- Every test-set id must have an embedding. ALLOW_MISSING (comma-separated set names) lets a set run with ids that
  could not be read from disk (idmt-bass: its PS/* folders are empty); the count is written to the output.
- Fair best of both: clips go to half A or B by sha256('pf|' + group) % 2 (whole uploader / pack / instrument on one side,
  as precision_first.py). Each clean head has two cutoffs fixed from training out-of-fold scores (precision-first and
  balanced). On each half the cutoff is chosen (precision-first, training's default, unless it fails there and balanced passes), then judged only on the other
  half. A head passes when both directions pass.
- Each result includes a digest of the evaluated input bias and weights. Carry this digest into any derived shipped-head
  report; do not backfill older reports from the shipped asset (that would not establish evaluation provenance)."""
import csv, glob, hashlib, json, os, struct, sys
import numpy as np
emb, old_p, new_p, board_p, out = sys.argv[1:6]
SETS = '/mnt/project-files/datasets/fresh-tests-2026-10-11/sets'
board = json.load(open(board_p)); PARENT = board.get('mergedInto', {})
def fold(tags):
    o = set(tags)
    for t in list(o):
        k = 0
        while t in PARENT and k < 5: t = PARENT[t]; o.add(t); k += 1
    return o
FA_CAP, FA_MIN_NEG = 0.01, 50
sets = {}
for n in board['sets']:
    z = np.load(f'{emb}/clap-{n}.npz'); rows = {r['id']: r for r in csv.DictReader(open(f'{SETS}/{n}.csv'))}
    X = z['clap'].astype(np.float32); X /= np.linalg.norm(X, axis=1, keepdims=True) + 1e-8
    ids, inv = np.unique(z['id'], return_inverse=True)
    keep = [i in rows for i in ids]; assert all(keep), (n, sum(not k for k in keep))
    missing = len(rows) - len(ids)
    assert missing == 0 or n in os.environ.get('ALLOW_MISSING', '').split(','), (n, 'ids without embeddings', missing)
    rs = [rows[i] for i in ids]
    sets[n] = dict(X=X, inv=inv, n=len(ids), missing=missing,
                   half=np.array([int(hashlib.sha256(('pf|' + r['group']).encode()).hexdigest()[:8], 16) % 2 for r in rs]),
                   pres=[fold(filter(None, r['present'].split(';'))) for r in rs], absn=[set(filter(None, r['absent'].split(';'))) for r in rs])
def coefficient_digest(head):
    """Identify the actual evaluated bias and weights, serialized as big-endian float64s."""
    values = [head['bias'], *head['weights']]
    return hashlib.sha256(struct.pack(f'>{len(values)}d', *values)).hexdigest()


def clip_scores(s, h):
    w = 1 / (1 + np.exp(-(s['X'] @ np.array(h['weights'], np.float32) + h['bias'])))
    c = np.full(s['n'], -1.0); np.maximum.at(c, s['inv'], w); return c
def stats(tag, sc, th, halves=(0, 1)):
    per = {}
    for n, s in sets.items():
        y = np.array([1 if tag in p else 0 if tag in q else -1 for p, q in zip(s['pres'], s['absn'])])
        m = (y >= 0) & np.isin(s['half'], halves)
        if not m.any(): continue
        hit = (sc[n] >= th) & m
        tp, fp = int((hit & (y == 1)).sum()), int((hit & (y == 0)).sum()); pos, neg = int(((y == 1) & m).sum()), int(((y == 0) & m).sum())
        per[n] = {'p': round(tp / (tp + fp), 3) if tp + fp else 0.0, 'r': round(tp / pos, 3) if pos else 0.0, 'positives': pos, 'negatives': neg, 'fp': fp}
    return per
def passes(per, counted, p_=0.6, r_=0.3, capped=None):
    """capped: sets under the false-alarm cap, from whole-set negatives (default: this split's own negatives)."""
    c = {k: v for k, v in per.items() if k in counted and v['positives'] > 0}
    if capped is None: capped = {k for k, v in per.items() if v['negatives'] >= FA_MIN_NEG}
    if not all(v['fp'] <= FA_CAP * v['negatives'] for k, v in per.items() if k not in counted and k in capped): return False
    return bool(c) and any(v['negatives'] for v in c.values()) and all(v['p'] >= p_ and v['r'] >= r_ for v in c.values())
BARS = {'60/30': (0.6, 0.3), '50/50': (0.5, 0.5), '60/60': (0.6, 0.6), '70/70': (0.7, 0.7)}
old = {h['label']: h for h in json.load(open(old_p))['heads']}
new = {h['label']: h for h in json.load(open(new_p))['heads']}
appPath = {t['tag']: t.get('appPath') for t in board['tags']}
res = []
for tag in sorted(set(old) & set(new)):
    so = {n: clip_scores(s, old[tag]) for n, s in sets.items()}; sn = {n: clip_scores(s, new[tag]) for n, s in sets.items()}
    full_new = stats(tag, sn, new[tag]['threshold'])
    counted = {k for k, v in full_new.items() if v['positives'] >= 5}
    capped = {k for k, v in full_new.items() if v['negatives'] >= FA_MIN_NEG}
    cand = {'precision-first': new[tag]['threshold'], 'balanced': new[tag]['thresholdBalanced']}
    fair = {}
    for sel in (0, 1):
        ok = {k: passes(stats(tag, sn, th, (sel,)), counted, capped=capped) for k, th in cand.items()}
        pick = 'precision-first' if ok['precision-first'] or not ok['balanced'] else 'balanced'   # training's default unless it fails here
        fair['chosenOn' + 'AB'[sel]] = {'choice': pick, 'cutoff': cand[pick], 'passOnOtherHalf': passes(stats(tag, sn, cand[pick], (1 - sel,)), counted, capped=capped)}
    fair['pass'] = all(v['passOnOtherHalf'] for v in fair.values())
    fair['precisionFirstBothHalves'] = all(passes(stats(tag, sn, cand['precision-first'], (h,)), counted, capped=capped) for h in (0, 1))
    picks = {fair['chosenOnA']['choice'], fair['chosenOnB']['choice']}
    ship = max(picks, key=lambda k: cand[k])   # mixed: the higher (precision-first pair) cutoff
    full = {k: stats(tag, sn, th) for k, th in cand.items()}
    oldfull = stats(tag, so, old[tag]['threshold'])
    res.append({'tag': tag, 'coefficientDigest': coefficient_digest(new[tag]),
                'coefficientDigestFormat': 'sha256-f64be-bias-weights-v1', 'countedSets': sorted(counted), 'fairBestOfBoth': fair, 'shipCutoff': ship, 'shipThreshold': cand[ship],
                'clean': full[ship], 'cleanPasses': {b: passes(full[ship], counted, *v) for b, v in BARS.items()},
                'cleanOther': {k: full[k] for k in cand if k != ship},
                'old': oldfull, 'oldPasses': {b: passes(oldfull, {k for k, v in oldfull.items() if v['positives'] >= 5}, *v) for b, v in BARS.items()},
                'oldThreshold': old[tag]['threshold'], 'appPathToday': appPath.get(tag)})
doc = {'about': __doc__.strip(), 'sets': {n: {'clips': s['n'], 'notEmbedded': s['missing']} for n, s in sets.items()}, 'tags': res}
json.dump(doc, open(out, 'w'), indent=1)
for r in res:
    f = r['fairBestOfBoth']; c = r['clean']
    print(f"{r['tag']:<18} fair={'PASS' if f['pass'] else 'fail'} ({f['chosenOnA']['choice'][:4]}/{f['chosenOnB']['choice'][:4]}) "
          f"old60/30={'Y' if r['oldPasses']['60/30'] else 'n'} app={((r['appPathToday'] or {}).get('pass60_30'))} | "
          + '  '.join(f"{n.split('-')[0]} {v['p']:.2f}/{v['r']:.2f} n+{v['positives']}{' fa' + str(v['fp']) if v['positives'] < 5 and v['fp'] else ''}" for n, v in c.items() if v['positives'] or v['fp']))
