"""Shared helpers for the EAT-heads candidate: labels, shipped decisions, per-tag metrics, blend rules.

The 46 scored tags and their display keys come from the judge-set per-tag.csv that summarize.py writes
(scripts/tag-baseline). Labels: 1 present, 0 absent, -1 unknown. Shipped decisions come from
`scripts/eval-tag.ts --decisions <file>` (clip id -> list of shown display keys)."""
import base64, csv, json
import numpy as np

CYMBAL_KEY = 'source:cymbals'  # the app shows cymbal as source:cymbals (per-tag counts match per-tag.csv)


def load_tags(per_tag_csv):
    rows = list(csv.DictReader(open(per_tag_csv)))
    tags = [r['tag'] for r in rows]
    key = {r['tag']: r['display_key'] for r in rows}
    if 'cymbal' in key:
        key['cymbal'] = CYMBAL_KEY
    return tags, key


def load_set(items_json, decisions_json, tags, key):
    """ids, Y (n x tags: 1/0/-1), S (n x tags: shipped shown 0/1)."""
    items = json.load(open(items_json))['items']
    dec = json.load(open(decisions_json))
    ids = [i['id'] for i in items]
    Y = np.array([[{'present': 1, 'absent': 0}.get(i['labels'].get(f'cat:{t}'), -1) for t in tags] for i in items])
    S = np.array([[int(key[t] in dec.get(i['id'], [])) for t in tags] for i in items])
    return ids, Y, S


def load_emb(npz):
    z = np.load(npz)
    return {str(i): e for i, e in zip(z['ids'], z['emb'])}


def prf(y, s):
    m = y >= 0
    y, s = y[m], s[m]
    tp = int(((y == 1) & (s == 1)).sum()); fp = int(((y == 0) & (s == 1)).sum()); fn = int(((y == 1) & (s == 0)).sum())
    P = tp / (tp + fp) if tp + fp else 0.0
    R = tp / (tp + fn) if tp + fn else 0.0
    F = 2 * P * R / (P + R) if P + R else 0.0
    return tp, fp, fn, P, R, F


def passes(P, R, p_min=0.6, r_min=0.3):
    return P >= p_min and R >= r_min


def per_tag_rows(Y, S, tags, key, note=None):
    rows = []
    for j, t in enumerate(tags):
        tp, fp, fn, P, R, F = prf(Y[:, j], S[:, j])
        bad = [x for x, b in (('precision', P < 0.6), ('recall', R < 0.3)) if b]
        rows.append(dict(tag=t, display_key=key[t], support=tp + fn, negatives=int((Y[:, j] == 0).sum()), tp=tp, fp=fp,
                         fn=fn, precision=round(P, 3), recall=round(R, 3), f1=round(F, 3), passes_60_30=passes(P, R),
                         fails_on='+'.join(bad), rule=(note or {}).get(t, '')))
    return rows


def summary(Y, S):
    tp = fp = fn = 0
    Ps, Rs, Fs, n = [], [], [], 0
    for j in range(Y.shape[1]):
        a, b, c, P, R, F = prf(Y[:, j], S[:, j])
        tp += a; fp += b; fn += c; Ps.append(P); Rs.append(R); Fs.append(F); n += passes(P, R)
    mP, mR = tp / (tp + fp), tp / (tp + fn)
    return dict(micro_p=round(mP, 3), micro_r=round(mR, 3), micro_f1=round(2 * mP * mR / (mP + mR), 3),
                macro_p=round(float(np.mean(Ps)), 3), macro_r=round(float(np.mean(Rs)), 3),
                macro_f1=round(float(np.mean(Fs)), 3), pass_60_30=int(n))


def write_csv(rows, path):
    with open(path, 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)


def fit_blend(y, s, q, min_pos=15, margin=0.02):
    """Per-tag rule picked on the tuning set only: keep shipped, OR / AND with q>=t, or replace with q>=t.
    Low capacity on purpose. A rule changes only when tuning F1 rises by >= margin, a tag that passes 60/30 on the
    tuning set must keep passing there, and tags with fewer than min_pos tuning positives keep the shipped decision."""
    m = y >= 0
    y, s, q = y[m], s[m], q[m]
    base = prf(y, s)
    best, bestm = ('keep', None, base[5]), base
    if (y == 1).sum() < min_pos:
        return best[:2], base, base
    ok0 = passes(base[3], base[4])
    for t in np.unique(np.quantile(q, np.linspace(0.5, 0.995, 60))):
        h = (q >= t).astype(int)
        for name, d in (('or', s | h), ('and', s & h), ('replace', h)):
            r = prf(y, d)
            if ok0 and not passes(r[3], r[4]):
                continue
            if r[5] >= best[2] + (margin if best[0] == 'keep' else 1e-9):
                best, bestm = (name, float(t), r[5]), r
    return best[:2], base, bestm


def apply_rule(rule, s, q):
    name, t = rule
    if name == 'keep' or t is None:
        return s
    h = (q >= t).astype(int)
    return {'or': s | h, 'and': s & h, 'replace': h}[name]


def f32_b64(v):
    return base64.b64encode(np.asarray(v, dtype='<f4').tobytes()).decode()


def b64_f32(s):
    return np.frombuffer(base64.b64decode(s), dtype='<f4').astype(np.float64)


def head_prob(head, X):
    """X: n x 1536 raw EAT embeddings. The scaler is folded into weights/bias."""
    z = X @ b64_f32(head['weights']) + head['bias']
    return 1.0 / (1.0 + np.exp(-z))
