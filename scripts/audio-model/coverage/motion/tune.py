"""Tune the motion-rule thresholds on TRAIN-SIDE clips only, and print P/R per tag and source.

Usage: python3 -I tune.py <work-dir> [--apply]
  <work-dir> holds: nsynth_b*.jsonl (NSynth TRAIN notes), roll_feats.jsonl + rolling_url_index (Iowa / VSCO train rolls),
  fs_train_feats.jsonl + fs_train picks (train-uploader Freesound mirror clips) -- see README for how each was made.
Labels:
  NSynth train: bright, dark, percussive from the note qualities. Held notes of organ/brass/reed/flute/string/vocal/
    synth_lead without fast_decay/percussive = sustained present; fast_decay or percussive notes = sustained absent.
    Every note (except tempo-synced / nonlinear_env ones) = absent for rhythmic, syncopated, rolling, pulsing,
    falling, wobbling, swelling (one held pitch, no pattern).
  Iowa / VSCO rolls: rolling present.
  Freesound train picks: the picked tag present; the keyword-free negatives from the same row groups absent for all.
Search: each rule's numbers on a small grid; keep the setting with the best min(P, R) on the pooled train clips,
ties to the higher F1. Prints the chosen numbers; --apply writes them to <work-dir>/tuned.json (pass that file to
score.py; motion_rules.py's T keeps its defaults).
"""
import csv, glob, itertools, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import motion_rules as MR

W = sys.argv[1]
NS_ABSENT = ['rhythmic', 'syncopated', 'rolling', 'pulsing', 'falling', 'wobbling', 'swelling']
HELD = {'organ', 'brass', 'reed', 'flute', 'string', 'vocal', 'synth_lead'}


def load():
    data = []   # (features, labels, source)
    for p in sorted(glob.glob(f'{W}/nsynth_b*.jsonl')):
        for l in open(p):
            f = json.loads(l); q = set(f['q']); lab = {}
            for t in ('bright', 'dark', 'percussive'): lab[t] = int(t in q)
            if f['family'] in HELD and not q & {'fast_decay', 'percussive'}: lab['sustained'] = 1
            elif q & {'fast_decay', 'percussive'}: lab['sustained'] = 0
            if not q & {'tempo-synced', 'nonlinear_env'}:
                for t in NS_ABSENT: lab[t] = 0
            data.append((f, lab, 'nsynth-train'))
    for l in open(f'{W}/roll_feats.jsonl'):
        data.append((json.loads(l), {'rolling': 1}, 'iowa/vsco-train'))
    if os.path.exists(f'{W}/fs_train_feats.jsonl'):
        picks = {}
        for p in (f'{W}/../sel/train-picks.csv', f'{W}/../sel/train-extra-picks.csv'):
            for r in csv.DictReader(open(p)): picks.setdefault(r['freesound_id'], set()).add(r['tag'])
        roles = {str(json.loads(l)['id']): json.loads(l)['role'] for l in open(f'{W}/../fs_train/fetched.jsonl')}
        for l in open(f'{W}/fs_train_feats.jsonl'):
            f = json.loads(l)
            if f['id'] in picks: data.append((f, {t: 1 for t in picks[f['id']]}, 'freesound-train'))
            elif roles.get(f['id']) == 'negative': data.append((f, {t: 0 for t in MR.RULES if t not in ('bright', 'dark')}, 'freesound-train-neg'))   # a random clip may be bright or dark
    return data


def pr(rule, data, tag):
    tp = fp = fn = 0
    for f, lab, src in data:
        if tag not in lab: continue
        p = rule(f)
        if lab[tag] and p: tp += 1
        elif lab[tag]: fn += 1
        elif p: fp += NS_WEIGHT if src == 'nsynth-train' and tag in WEIGHTED else 1
    P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn) if tp + fn else 0.0
    return P, R, tp + fn, round(tp + fp)


GRID = {
    'rhythmic': dict(onsets=[6, 8, 12], beat_acf=[.3, .4, .5], beat_acf2=[0, .05, .1, .2], ioi_cv=[.6, .8, 1.0, 9]),
    'syncopated': dict(onsets=[6, 8, 12], beat_acf=[.3, .4], beat_acf2=[.05, .1, .2], sync=[.25, .3, .35, .4, .45]),
    'sustained': dict(active_s=[1, 1.5, 2.5], sustain=[.3, .4, .5], depth_db=[8, 12, 16, 99], onset_rate=[1, 1.5, 3], voiced=[0, .5, .8]),
    'pulsing': dict(am_acf=[.3, .4, .5, .6], depth_db=[3, 6, 9], voiced=[0, .5, .8], am_hz_lo=[1, 2], am_hz_hi=[12, 16]),
    'swelling': dict(swell_r=[.3, .4, .5, .6, .7, .8], swell_len_s=[.5, .8, 1, 1.5, 2], swell_db=[4, 6, 8, 12, 16]),
    'falling': dict(pitch_drop_oct=[.15, .25, .5], pitch_r=[-.5, -.7, -.85], voiced=[.3, .5], cent_trend_oct=[-.3, -.5, -.8, -1.2], cent_r=[-.4, -.6, -.8]),
    'wobbling': dict(cent_acf=[.15, .2, .3, .4], cent_wob_std=[.1, .2, .3, .4], voiced=[0, .5, .8], sustain=[0, .2, .3, .4]),
    'percussive': dict(attack_s=[.02, .035, .05, .08], decay20_s=[.2, .3, .5, .8, 1.2]),
    'rolling': dict(fast_acf=[.2, .3, .4], ioi_med=[.1, .13, .16], onsets=[6, 8, 12], ioi_cv=[.4, .6, .8, 9]),
    'bright': dict(above4000=[.001, .002, .003, .005, .008, .012, .02, .04]),
    'dark': dict(above1000=[.0002, .0005, .001, .002, .004, .008]),
}
# NSynth notes are many and easy; count each NSynth false alarm as this fraction of a Freesound one for the motion
# tags, so the pooled precision is not just "does it fire on single notes".
NS_WEIGHT = .2
WEIGHTED = {'rhythmic', 'syncopated', 'rolling', 'pulsing', 'falling', 'wobbling', 'swelling'}


def main():
    data = load()
    print('clips', len(data), {s: sum(1 for d in data if d[2] == s) for s in {d[2] for d in data}})
    chosen = {}
    for tag, grid in GRID.items():
        keys = list(grid); best = None
        for vals in itertools.product(*grid.values()):
            t = dict(MR.T[tag], **dict(zip(keys, vals)))
            rule = lambda f, t=t, tag=tag: MR.RULES[tag](f, t)
            P, R, npos, npred = pr(rule, data, tag)
            score = (min(P, R), 2 * P * R / (P + R) if P + R else 0)
            if best is None or score > best[0]: best = (score, t, P, R, npos)
        chosen[tag] = best[1]
        rule = lambda f, t=best[1], tag=tag: MR.RULES[tag](f, t)
        by = {s: pr(rule, [d for d in data if d[2] == s], tag) for s in sorted({d[2] for d in data})}
        print(f"{tag:11s} P {best[2]:.2f} R {best[3]:.2f} pos {best[4]}  {json.dumps({k: v for k, v in best[1].items()})}")
        for s, (P, R, n, k) in by.items():
            if n or k: print(f"     {s:22s} P {P:.2f} R {R:.2f} pos {n} fired {k}")
    if '--apply' in sys.argv:
        json.dump(chosen, open(f'{W}/tuned.json', 'w'), indent=1); print('wrote', f'{W}/tuned.json')


if __name__ == '__main__':
    main()
