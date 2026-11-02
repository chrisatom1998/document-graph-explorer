"""Train per-tag logistic-regression heads on frozen EAT-base embeddings and pick the blend rule per tag.

Candidate only: nothing in the app reads the output. CPU only, about 3 minutes once the embeddings exist.

Training rows (train-manifest/, ids and tags only, no audio):
  fsd50k-train.csv  FSD50K dev, split=train only (never val, never eval); all 46 tags labelled.
  egmd.tsv          E-GMD v2 keep rows; drums and percussion added to every row; all tags known.
  audioset-a.tsv    AudioSet-a weak rows: positive for the listed tags, unknown for the rest.
Tuning: the 1,338-clip FSD50K dev-val set only (C per tag from {.003,.03,.3}, F1-best threshold, blend rule).
The judge set is scored once with the frozen heads and rules; it is never trained or tuned on.

Usage:
  train_heads.py --feats DIR --per-tag-csv judge/per-tag.csv \
      --devval-set devval/items.json --devval-decisions devval/decisions.json \
      --judge-set judge/items.json --judge-decisions judge/decisions.json \
      --heads-out heads.json --report-dir OUT
DIR holds eat-{fsdtrain,eg2,asa,devval,judge}.npz from extract_eat.py."""
import argparse, csv, json, os, sys, time, warnings
from collections import Counter
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
EAT_MODEL = 'worstchan/EAT-base_epoch30_finetune_AS2M'
EAT_REVISION = '60d61e8b2e9e5ba3be6860285de80cb7d625ccbb'
IMPLY = {'whisper': ['voice'], 'vocal shout': ['voice'], 'vocal scream': ['voice'], 'cowbell': ['percussion']}


def training_rows(feats, tags):
    X, Y, src = [], [], []
    fe = C.load_emb(f'{feats}/eat-fsdtrain.npz')
    for r in csv.DictReader(open(f'{HERE}/train-manifest/fsd50k-train.csv')):
        if r['id'] not in fe:
            continue
        t = set(r['tags'].split('|')) - {''}
        X.append(fe[r['id']]); Y.append([int(x in t) for x in tags]); src.append('fsd50k-train')
    ee = C.load_emb(f'{feats}/eat-eg2.npz')
    for r in csv.DictReader(open(f'{HERE}/train-manifest/egmd.tsv'), delimiter='\t'):
        if r['id'] not in ee:
            continue
        t = set(r['tags'].split('|')) | {'percussion', 'drums'}
        X.append(ee[r['id']]); Y.append([int(x in t) for x in tags]); src.append('egmd')
    ae = C.load_emb(f'{feats}/eat-asa.npz')
    for r in csv.DictReader(open(f'{HERE}/train-manifest/audioset-a.tsv'), delimiter='\t'):
        if r['id'] not in ae:
            continue
        t = set(r['tags'].split('|'))
        t |= {x for y in list(t) for x in IMPLY.get(y, [])}
        X.append(ae[r['id']]); Y.append([1 if x in t else -1 for x in tags]); src.append('audioset-a')
    return np.array(X), np.array(Y), dict(Counter(src))


def main():
    ap = argparse.ArgumentParser()
    for a in ('feats', 'per-tag-csv', 'devval-set', 'devval-decisions', 'judge-set', 'judge-decisions', 'heads-out',
              'report-dir'):
        ap.add_argument(f'--{a}', required=True)
    a = ap.parse_args()
    os.makedirs(a.report_dir, exist_ok=True)
    tags, key = C.load_tags(a.per_tag_csv)
    X, Y, counts = training_rows(a.feats, tags)
    sc = StandardScaler().fit(X)
    Xs = sc.transform(X)

    def held(items, decisions, name):
        ids, Yv, S = C.load_set(items, decisions, tags, key)
        e = C.load_emb(f'{a.feats}/eat-{name}.npz')
        return np.array([e[i] for i in ids]), Yv, S

    Rd, Yd, Sd = held(a.devval_set, a.devval_decisions, 'devval')
    Rj, Yj, Sj = held(a.judge_set, a.judge_decisions, 'judge')
    Xd, Xj = sc.transform(Rd), sc.transform(Rj)
    Pd, Pj = np.zeros(Yd.shape), np.zeros(Yj.shape)
    heads, out, t0 = {}, [], time.time()
    for j, t in enumerate(tags):
        m = Y[:, j] >= 0
        npos = int((Y[m, j] == 1).sum())
        if npos < 5:
            heads[t] = None
            continue
        best = None
        for c in (0.003, 0.03, 0.3):
            clf = LogisticRegression(C=c, class_weight='balanced', max_iter=3000).fit(Xs[m], Y[m, j])
            pd_ = clf.predict_proba(Xd)[:, 1]
            md = Yd[:, j] >= 0
            grid = np.unique(np.quantile(pd_[md], np.linspace(0.3, 0.995, 80)))
            f, th = max((C.prf(Yd[md, j], (pd_[md] >= g).astype(int))[5], g) for g in grid)
            if best is None or f > best[0]:
                best = (f, th, c, clf, pd_)
        f, th, c, clf, pd_ = best
        Pd[:, j], Pj[:, j] = pd_, clf.predict_proba(Xj)[:, 1]
        w = clf.coef_[0] / sc.scale_  # fold the scaler into the head
        b = float(clf.intercept_[0] - np.dot(clf.coef_[0], sc.mean_ / sc.scale_))
        heads[t] = dict(train_pos=npos, train_n=int(m.sum()), C=c, threshold=float(th), devval_f1=round(f, 3), w=w, b=b)
    train_s = round(time.time() - t0)

    Aj, Bj = np.zeros_like(Sj), Sj.copy()
    note_a, note_b, fit_rows = {}, {}, []
    for j, t in enumerate(tags):
        h = heads[t]
        entry = dict(tag=t, display_key=key[t])
        if h is None:
            note_a[t], note_b[t] = 'no head (<5 training positives)', 'keep'
            entry.update(head=None, rule=dict(op='keep', eat_min=None))
            out.append(entry)
            continue
        Aj[:, j] = (Pj[:, j] >= h['threshold']).astype(int)
        note_a[t] = f"eat-lr C={h['C']} p>={h['threshold']:.3f}"
        rule, base, bm = C.fit_blend(Yd[:, j], Sd[:, j], Pd[:, j])
        note_b[t] = rule[0] + (f' eat>={rule[1]:.3f}' if rule[1] is not None else '')
        Bj[:, j] = C.apply_rule(rule, Sj[:, j], Pj[:, j])
        fit_rows.append(dict(tag=t, train_pos=h['train_pos'], train_n=h['train_n'], C=h['C'],
                             threshold=round(h['threshold'], 4), devval_f1=h['devval_f1'], blend_rule=note_b[t],
                             devval_shipped_F1=round(base[5], 3), devval_blend_F1=round(bm[5], 3)))
        entry.update(head=dict(C=h['C'], threshold=round(h['threshold'], 6), devval_f1=h['devval_f1'],
                               train_pos=h['train_pos'], train_n=h['train_n'], bias=h['b'], weights=C.f32_b64(h['w'])),
                     rule=dict(op=rule[0], eat_min=rule[1]))
        out.append(entry)

    # The exported float32 heads must reproduce the decisions above exactly.
    for j, e in enumerate(out):
        if e['head'] is None or e['rule']['op'] == 'keep':
            continue
        q = C.head_prob(e['head'], Rj)
        r = (e['rule']['op'], e['rule']['eat_min'])
        assert np.array_equal(C.apply_rule(r, Sj[:, j], q), Bj[:, j]), f"exported head drifts for {e['tag']}"

    json.dump(dict(
        version=1, name='eat-heads-candidate-2026-11-01', status='candidate (not used by the app)',
        encoder=dict(model=EAT_MODEL, revision=EAT_REVISION, license='MIT',
                     code='https://github.com/cwx-worst-one/EAT (MIT, LICENSE)',
                     weights=f'https://huggingface.co/{EAT_MODEL} (MIT)',
                     features='[CLS, mean frame token] = 1536-d, mean over up to three 10 s windows; see extract_eat.py'),
        heads_license='CC BY-NC-SA 4.0 (trained on FSD50K CC BY / CC BY-NC clips and AudioSet; non-commercial)',
        scaler='folded into weights and bias: p = sigmoid(x . weights + bias) on the raw embedding',
        weights_encoding='base64 little-endian float32, 1536 values',
        blend='per tag: keep shipped | or (shown or p>=eat_min) | and (shown and p>=eat_min) | replace (p>=eat_min)',
        train_clips=counts, tags=out), open(a.heads_out, 'w'), indent=1)
    C.write_csv(fit_rows, f'{a.report_dir}/devval-fit.csv')
    C.write_csv(C.per_tag_rows(Yj, Sj, tags, key), f'{a.report_dir}/judge-shipped-per-tag.csv')
    C.write_csv(C.per_tag_rows(Yj, Aj, tags, key, note_a), f'{a.report_dir}/judge-eat-heads-alone-per-tag.csv')
    C.write_csv(C.per_tag_rows(Yj, Bj, tags, key, note_b), f'{a.report_dir}/judge-candidate-per-tag.csv')
    s = dict(train_clips=counts, train_seconds=train_s, shipped=C.summary(Yj, Sj), eat_heads_alone=C.summary(Yj, Aj),
             shipped_plus_eat=C.summary(Yj, Bj), rules_changed={t: n for t, n in note_b.items() if n != 'keep'},
             no_head=[t for t in tags if heads[t] is None])
    json.dump(s, open(f'{a.report_dir}/summary.json', 'w'), indent=1)
    print(json.dumps({k: s[k] for k in ('train_clips', 'train_seconds', 'shipped', 'shipped_plus_eat', 'no_head')}, indent=1))


if __name__ == '__main__':
    main()
