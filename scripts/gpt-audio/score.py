"""Scores gpt-audio-1.5 answers (from label.py) against a judge set's truth and puts main's committed scores beside them.

Usage: python3 scripts/gpt-audio/score.py <task> <manifest> <answers.json> [reference-main.json]
Pass bar (Chris): precision AND recall at least 0.70 per tag; key exact at least 70%. Only clips GPT answered are scored,
so with --limit the GPT column is a sample: its 95% intervals are printed, and "beats main" needs the interval to clear
main's number, not just the point estimate.
"""
import json, math, sys

task, manifest, answers_path = sys.argv[1:4]
ref = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else {}
ans = json.load(open(answers_path)); A = ans['answers']
usd = sum(a['usd'] for a in A.values()); audio_tok = sum(a['usage']['audioIn'] for a in A.values())
print(f"{ans['model']} on {task}: {len(A)} clips, ${usd:.3f} (${usd / max(len(A), 1):.4f}/clip, "
      f"{audio_tok / max(len(A), 1):.0f} audio tokens/clip)")


def wilson(k, n):
    if not n: return (0, 0)
    p, z = k / n, 1.96; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def tag_table(truth, tags, main):
    print(f"{'tag':<16}{'pos':>5}{'neg':>5}   {'GPT P / R':<13}{'GPT 95% P / R':<24}{'main P / R':<13}{'GPT 70/70':<10}vs main")
    out = {}
    for t in tags:
        tp = fp = fn = pos = neg = 0
        for cid, (present, absent) in truth.items():
            if cid not in A: continue
            said = t in A[cid]['answer'].get('present', [])
            if t in present: pos += 1; tp += said; fn += not said
            elif t in absent: neg += 1; fp += said
        if not pos: continue
        P = tp / (tp + fp) if tp + fp else 0.0; R = tp / pos
        pl, ph = wilson(tp, tp + fp); rl, rh = wilson(tp, pos); m = main.get(t)
        lo, hi = (pl, ph) if P <= R else (rl, rh)          # interval of the binding metric, min(P, R)
        better = '' if not m else 'better' if lo > min(m) else 'worse' if hi < min(m) else 'no clear gain'
        print(f"{t:<16}{pos:>5}{neg:>5}   {P:.2f} / {R:.2f}  {pl:.2f}-{ph:.2f} / {rl:.2f}-{rh:.2f}  "
              f"{f'{m[0]:.2f} / {m[1]:.2f}' if m else '-':<13}{'pass' if P >= .7 and R >= .7 else 'fail':<10}{better}")
        out[t] = {'precision': round(P, 3), 'recall': round(R, 3), 'tp': tp, 'fp': fp, 'fn': fn, 'positives': pos, 'negatives': neg,
                  'precisionCI95': [round(pl, 3), round(ph, 3)], 'recallCI95': [round(rl, 3), round(rh, 3)], 'main': m, 'vsMain': better}
    return out


m = json.load(open(manifest))
if task == 'instruments':
    truth = {}
    for it in m['items']:
        rs = [r for r in it['reviews'] if r['dimension'] == 'source']
        truth[it['id']] = ({r['label'] for r in rs if r['state'] == 'present'}, {r['label'] for r in rs if r['state'] == 'absent'})
    tags = sorted({t for p, a in truth.values() for t in p | a})
    result = tag_table(truth, tags, ref.get('instruments', {}))
elif task == 'effects':
    clips = [c for c in m['clips'] if c['split'] == 'heldout' and c['round'] == 1]
    tags = sorted({l for c in clips for l in c['labels']})
    truth = {c['id']: (set(c['labels']), set(tags) - set(c['labels'])) for c in clips}
    result = tag_table(truth, tags, ref.get('effects', {}))
else:
    n = exact = relative = fifth = parallel = 0
    for it in m['items']:
        k = it.get('key') or {}
        if it['id'] not in A or k.get('confidence') != 2 or 'tonic' not in k: continue   # main's scorer: the same 395
        tonic, mode = k['tonic'], k['mode']; said = A[it['id']]['answer']['key'].split()
        names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; st, sm = names.index(said[0]), said[1]
        n += 1; exact += (st, sm) == (tonic, mode)
        if sm == mode and (st - tonic) % 12 in (5, 7): fifth += 1
        if sm != mode and (st - tonic) % 12 == (3 if mode == 'minor' else 9): relative += 1
        if sm != mode and st == tonic: parallel += 1
    lo, hi = wilson(exact, n)
    print(f"key exact {exact}/{n} = {exact / max(n, 1):.3f} (95% {lo:.2f}-{hi:.2f}); fifth {fifth}, relative {relative}, "
          f"parallel {parallel}; main {ref.get('keyExact', '-')}")
    result = {'n': n, 'exact': round(exact / max(n, 1), 3), 'exactCI95': [round(lo, 3), round(hi, 3)], 'fifth': fifth,
              'relative': relative, 'parallel': parallel, 'main': ref.get('keyExact')}
json.dump({'model': ans['model'], 'task': task, 'clips': len(A), 'usd': round(usd, 4), 'result': result},
          open(answers_path.replace('.json', '-score.json'), 'w'), indent=1)
