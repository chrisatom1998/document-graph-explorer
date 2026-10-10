"""Score the motion rules on held-out TEST clips (no tuning happens here; thresholds come from motion_rules.T or a
tuned.json made by tune.py on train-side clips). Usage:
  python3 -I score.py <test-feats.jsonl> <eval-motion.json> [tuned.json]          Freesound held-out clips
  python3 -I score.py --nsynth <nsynth-test-feats.jsonl> [tuned.json]            NSynth test (bright, dark, percussive, sustained)
Precision here is a LOWER BOUND: the negatives are keyword-free random Freesound clips, and some of them really are
sustained, percussive or rhythmic sounds that nobody tagged."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import motion_rules as MR
from tune import HELD

def rule(tag, T): return lambda f: MR.RULES[tag](f, T.get(tag, MR.T[tag]))
def report(rows):
    out = {}
    for tag in MR.RULES:
        tp = fp = fn = neg = 0
        for p, lab in rows:
            if tag not in lab: continue
            if lab[tag]: tp += p[tag]; fn += not p[tag]
            else: fp += p[tag]; neg += 1
        if tp + fn == 0: continue
        P = tp / (tp + fp) if tp + fp else 0.0; R = tp / (tp + fn)
        out[tag] = dict(P=round(P, 3), R=round(R, 3), positives=tp + fn, negatives=neg, tp=tp, fp=fp, passes_50_50=P >= .5 and R >= .5)
        print(f'{tag:11s} P {P:.2f} R {R:.2f}  pos {tp + fn:3d} neg {neg:3d}  tp {tp} fp {fp}' + ('  PASS 50/50' if P >= .5 and R >= .5 else ''))
    return out

if __name__ == '__main__':
    a = [x for x in sys.argv[1:]]
    if a[0] == '--nsynth':
        T = json.load(open(a[2])) if len(a) > 2 else {}
        rows = []
        for l in open(a[1]):
            f = json.loads(l); q = set(f['q']); lab = {t: int(t in q) for t in ('bright', 'dark', 'percussive')}
            if f['family'] in HELD and not q & {'fast_decay', 'percussive'}: lab['sustained'] = 1
            elif q & {'fast_decay', 'percussive'}: lab['sustained'] = 0
            rows.append(({t: bool(rule(t, T)(f)) for t in MR.RULES}, lab))
    else:
        T = json.load(open(a[2])) if len(a) > 2 else {}
        feats = {f['id']: f for f in map(json.loads, open(a[0]))}
        rows = []
        for it in json.load(open(a[1]))['items']:
            fid = it['id'].split(':')[1]
            if fid not in feats: print('no features', fid); continue
            lab = {k[4:]: int(v == 'present') for k, v in it['labels'].items()}
            rows.append(({t: bool(rule(t, T)(feats[fid])) for t in MR.RULES}, lab))
    print(json.dumps(report(rows)))
