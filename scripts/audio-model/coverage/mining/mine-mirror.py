"""Coverage idea #1, step A: train-only Freesound mirror candidates per tag, by CED-base + round 11 teacher votes. No audio.

python3 -I mine-mirror.py <ced run dir> <mirror teacher features dir> <teacher dir> <heldout config.json> \
    <ced-tag-map.json> <ced-confirm-rules.json> <in-training ids.txt> <out dir> --hp <hp-cutoffs.json> [--focus tags.txt]
  <ced run dir>: runs/ced-freesound-38026076860-1 of cmjatom/dge-eval-runs (CED-base AudioSet probabilities of the first
    10 s of all 494,513 clips of benjamin-paine/freesound-laion-640k; part-*/<shard>.npz + labels.txt).
  <mirror teacher features dir>: round11/mirror of cmjatom/dge-audio-training (teacher-features.py MODE=mirror, ~95k clips).
  <teacher dir>: labelfix/oof-scores.py output (teacher.pt = the 5 fold models, thresholds.json, val.json), fit on train-side
    clips only. Mirror clips are never in that fit, so the fold average applies to them as is.
  <in-training ids.txt>: Freesound ids already in (or already planned for) training, one per line; dropped as not new.
  --hp: labelfix/build-absent-fix.py hp-cutoffs.json (tag -> out-of-fold 0.9-precision teacher cutoff).

Votes per (clip, tag):
  CED      best mapped class >= CED_MIN (0.5, ced-select.py's MIN_SCORE). ced-tag-map.json classes are specific enough to
           stand alone; broad-ced-map.json classes (this folder) only agree with the teacher, never stand alone.
  teacher  fold-averaged teacher prob >= the tag's frozen out-of-fold threshold, used only where the teacher's out-of-fold
           min(P, R) on the tag >= TEACHER_Q (0.3). 'teacher-strong' = prob >= the tag's out-of-fold 0.9-precision cutoff.
Tiers (best first): two-votes (CED + teacher), teacher-only (no CED mapping for the tag, teacher-strong, and the tag's
  training positives not >80% from one non-Freesound source; lower tier),
  ced-only (specific CED map, no teacher features for the clip; lower tier). CED >= CED_MIN with teacher features that say no
  is counted as 'disputed' and dropped.
Filters (heldout.py): held-out / reserved / FSD50K-eval / re-hosted ids for all tags, held-out uploaders for all tags, the
  three reserved-uploader hash rules, uploaders held out for the same tag; CC Sampling+ is already absent from the run; ids
  already in training are dropped; at most PER_UPLOADER clips per uploader per tag and PER_TAG per tag (tiers in order).
Writes <out dir>/candidates.csv (train-only; tag, freesound_id, username, licence, seconds, tier, ced, teacher) and
  per-tag.csv (counts per tier and why rows were dropped). uploader_heldout_other_tag = 1 when the keyword list holds that
  uploader out for some OTHER tag: allowed by the same-tag rule, but ced-select.py's stricter rule drops it (strict_kept counts
  what survives that). Licence codes: 0 CC0, 1 BY 4.0, 2 BY 3.0, 3 NC 3.0, 4 NC 4.0.
"""
import argparse, csv, glob, importlib.util, json, os, sys
from collections import Counter, defaultdict

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
AM = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import heldout  # noqa: E402
spec = importlib.util.spec_from_file_location('ft', os.path.join(AM, 'round11', 'fit-teacher.py'))
ft = importlib.util.module_from_spec(spec); spec.loader.exec_module(ft)
LIC = {0: 'CC0', 1: 'BY4', 2: 'BY3', 3: 'NC3', 4: 'NC4'}
CED_MIN = float(os.environ.get('CED_MIN', '0.5')); TEACHER_Q = float(os.environ.get('TEACHER_Q', '0.3'))
PER_UPLOADER = int(os.environ.get('PER_UPLOADER', '15')); PER_TAG = int(os.environ.get('PER_TAG', '800'))
TIERS = ['two-votes', 'teacher-only', 'ced-only']


def main():
    ap = argparse.ArgumentParser()
    for k in ('ced', 'mirror', 'teacher', 'heldout', 'tagmap', 'rules', 'intrain', 'out'): ap.add_argument(k)
    ap.add_argument('--hp', required=True, help="labelfix build-absent-fix.py hp-cutoffs.json: tag -> out-of-fold 0.9-precision cutoff")
    ap.add_argument('--focus', help='tags to report first (one per line); all tags are mined')
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    spec_map = json.load(open(a.tagmap))['tags']
    broad = json.load(open(os.path.join(HERE, 'broad-ced-map.json')))['tags']
    rules = json.load(open(a.rules))
    for t, c in rules['confirm'].items():   # confirm classes of the keyword tags: agreement only (they were built to check words)
        if t not in spec_map: broad.setdefault(t, c)
    broad = {t: c for t, c in broad.items() if t not in spec_map}
    # teacher on the mirror clips that have features
    f, vocab, kind = ft.load(os.path.join(a.teacher, 'teacher.pt'))
    thr = json.load(open(os.path.join(a.teacher, 'thresholds.json'))); val = json.load(open(os.path.join(a.teacher, 'val.json')))
    hp = json.load(open(a.hp))   # tag -> out-of-fold 0.9-precision cutoff (train-side clips only)
    usable = [t for t in vocab if t in thr and min(val[t].get('oof_p', 0), val[t].get('oof_r', 0)) >= TEACHER_Q]
    tcol = {t: vocab.index(t) for t in usable}
    # teacher-only needs positives from more than one source: a tag taught by one dataset (chorused = EGFxSet guitar, organ synth
    # = NSynth, sub drop = code renders) teaches that dataset's sound, not the tag. Freesound-led tags are fine (the mirror is Freesound).
    z = np.load(os.path.join(a.teacher, 'oof.npz')); src_n = defaultdict(Counter)
    for sname, o in zip(z['source'], z['own']):
        for t in str(o).split('|'): src_n[t][str(sname)] += 1
    one_source = {t for t, c in src_n.items() if c and c.most_common(1)[0][0] != 'freesound' and c.most_common(1)[0][1] > 0.8 * sum(c.values())}
    teach = {}
    for fn in sorted(glob.glob(os.path.join(a.mirror, '*.npz'))):
        z = np.load(fn); P = f(ft.feats(z, kind))
        for i, cid in enumerate(z['id']): teach[int(cid)] = P[i]
    print(f'teacher: {len(teach)} mirror clips with features; {len(usable)} of {len(vocab)} tags usable (oof min(P,R) >= {TEACHER_Q})', flush=True)
    intrain = {int(x) for x in open(a.intrain).read().split()}
    H = heldout.HeldOut(a.heldout)
    tags = sorted(set(spec_map) | set(broad) | set(usable))
    rows = defaultdict(list); why = defaultdict(Counter)
    for fn in sorted(glob.glob(os.path.join(a.ced, 'part-*', '*.npz'))):
        z = np.load(fn)
        ids = z['freesound_id'].astype(np.int64); P = z['probs'].astype(np.float32)
        users, lic, sec = z['username'], z['license'], z['seconds']
        cs = {t: P[:, c].max(1) for t, c in {**spec_map, **broad}.items()}
        T = np.stack([teach.get(int(i), np.full(len(vocab), np.nan, np.float32)) for i in ids])   # nan: no teacher features
        has = ~np.isnan(T[:, 0])
        for t in tags:
            c = cs.get(t); tv = T[:, tcol[t]] if t in tcol else None
            cv = c >= CED_MIN if c is not None else np.zeros(len(ids), bool)
            tvote = (tv >= thr[t]) & has if tv is not None else np.zeros(len(ids), bool)
            tier = np.full(len(ids), -1)
            if t in spec_map: tier[cv & ~has] = 2
            if t not in spec_map and t not in broad and tv is not None and t in hp and t not in one_source: tier[has & (tv >= hp[t])] = 1
            tier[cv & tvote] = 0
            if tv is not None: why[t]['disputed (CED yes, teacher no)'] += int((cv & has & ~tvote).sum())
            for k in np.where(tier >= 0)[0]:
                i = int(ids[k]); u = str(users[k])
                r = H.why(i, u, t)
                if r: why[t][r] += 1; continue
                if i in intrain: why[t]['already in training'] += 1; continue
                ck = float(c[k]) if c is not None else None; tk = float(tv[k]) if tv is not None and has[k] else None
                rows[t].append((int(tier[k]), -(tk if tk is not None else ck), i, u, LIC.get(int(lic[k]), '?'), round(float(sec[k]), 2), TIERS[tier[k]],
                                round(ck, 3) if ck is not None else '', round(tk, 3) if tk is not None else ''))
    focus = [l.strip() for l in open(a.focus)] if a.focus else []
    out, summ = [], []
    for t in tags:
        lst = sorted(rows[t]); per = Counter(); kept = Counter()
        for r in lst:
            if per[r[3]] >= PER_UPLOADER: why[t]['uploader cap'] += 1; continue
            if sum(kept.values()) >= PER_TAG: why[t]['tag cap'] += 1; continue
            per[r[3]] += 1; kept[r[6]] += 1
            out.append((t, r[2], r[3], r[4], r[5], r[6], r[7], r[8], int(r[3].casefold() in H.kw_users)))
        s = {'tag': t, 'focus': int(t in focus), 'ced_map': 'specific' if t in spec_map else 'broad' if t in broad else 'none',
             'teacher_usable': int(t in tcol), 'one_source': int(t in one_source), **{k: kept[k] for k in TIERS}, 'kept': sum(kept.values()),
             'uploaders': len({o[2] for o in out if o[0] == t}), 'open_licence': sum(1 for o in out if o[0] == t and o[3] in ('CC0', 'BY4', 'BY3')),
             'strict_kept': sum(1 for o in out if o[0] == t and not o[8])}
        s.update({f'dropped: {k}': v for k, v in why[t].items()})
        summ.append(s)
    with open(os.path.join(a.out, 'candidates.csv'), 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['tag', 'freesound_id', 'username', 'licence', 'seconds', 'tier', 'ced', 'teacher', 'uploader_heldout_other_tag']); w.writerows(out)
    cols = []
    for s in summ:
        for k in s:
            if k not in cols: cols.append(k)
    with open(os.path.join(a.out, 'per-tag.csv'), 'w', newline='') as fh:
        w = csv.DictWriter(fh, cols, restval=0); w.writeheader(); w.writerows(sorted(summ, key=lambda s: (-s['focus'], s['tag'])))
    print(f'{len(out)} candidate rows, {len({o[1] for o in out})} clips, {len([s for s in summ if s["kept"]])} tags', flush=True)


if __name__ == '__main__':
    main()
