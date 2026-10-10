"""Score what the real app displays on the locked holdout, per label and per duration route.

Usage: python3 -I scripts/licensed-pilot/score_app.py <holdout.json> <out.json> <ui-tags.json> [<ui-tags.json>...]
<ui-tags.json>: output of `npx vite-node scripts/ui-export-tags.mjs <graph-export.json> <ui-tags.json>` for runs of
scripts/short-clip-upload-eval.mjs over the holdout (files uploaded as <id><ext>, so no file-name hint reaches the app).

The app's Sounds panel shows a tag in one of three ways, and each is scored separately:
- confident: tier "likely" and not marked maybe;
- uncertain: shown, but only as "possible" or "(maybe)". This is an abstention: the app hedges.
- not shown.
"strict" counts only confident tags as calls (an uncertain tag on a positive is a miss, on a negative not a false
positive). "shown" counts any displayed tag as a call. Routes: clips of at most 2.25 s (one-shot route) and longer
clips are always reported apart; "all" is given only for completeness and is never used to promote a head that a
route does not run. Filename-only tags never count (the upload names are opaque ids anyway).
Unknown holdout rows are not scored; how often a label shows on them is reported as fires_on_unlabelled.
"""
import json, os, re, sys

HOLD, OUT, *TAGS = sys.argv[1:]
hold = json.load(open(HOLD)); items = {i['id']: i for i in hold['items']}
shown = {}
for f in TAGS:
    for r in json.load(open(f)):
        hid = os.path.splitext(os.path.basename(r['file']))[0]
        if hid not in items: continue
        tags = {}
        for t in r['tags']:
            # "<dimension>:<label> [<tier>][ (maybe)] <scores>"; every displayed tag carries a tier.
            m = re.match(r'^[^:]+:(.+?) \[(\w+)\]( \(maybe\))?(?: |$)', t)
            if not m: raise ValueError(f'unparsed tag: {t}')
            label, tier, maybe = m[1], m[2], bool(m[3])
            conf = tier == 'likely' and not maybe
            tags[label] = max(tags.get(label, 0), 2 if conf else 1)
        shown[hid] = {'tags': tags, 'status': r.get('status')}

def score(label, route):
    rows = [i for i in items.values() if (route == 'all' or i['short'] == (route == 'short')) and i['id'] in shown]
    pos = [i for i in rows if i['labels'][label] == 1]; neg = [i for i in rows if i['labels'][label] == 0]
    unk = [i for i in rows if i['labels'][label] is None]
    lv = lambda i: shown[i['id']]['tags'].get(label, 0)
    out = {'support_pos': len(pos), 'support_neg': len(neg)}
    for mode, cut in (('strict', 2), ('shown', 1)):
        tp = sum(lv(i) >= cut for i in pos); fp = sum(lv(i) >= cut for i in neg); fn = len(pos) - tp
        P = tp / (tp + fp) if tp + fp else None; R = tp / len(pos) if pos else None
        out[mode] = {'precision': None if P is None else round(P, 3), 'recall': None if R is None else round(R, 3),
                     'f1': round(2 * P * R / (P + R), 3) if P and R else (0.0 if P is not None and R is not None else None),
                     'tp': tp, 'false_positives': fp, 'misses': fn,
                     'false_positive_ids': [i['id'] for i in neg if lv(i) >= cut][:30]}
    out['abstentions_pos'] = sum(lv(i) == 1 for i in pos); out['abstentions_neg'] = sum(lv(i) == 1 for i in neg)
    out['fires_on_unlabelled'] = {'n': len(unk), 'confident': sum(lv(i) == 2 for i in unk), 'any': sum(lv(i) >= 1 for i in unk)}
    for mode in ('strict', 'shown'):
        p, r = out[mode]['precision'], out[mode]['recall']
        out[mode]['meets_70'] = p is not None and r is not None and p >= .7 and r >= .7
        out[mode]['meets_90'] = p is not None and r is not None and p >= .9 and r >= .9
    return out

missing = [i for i in items if i not in shown]
report = {'holdout_lock': open(os.path.join(os.path.dirname(HOLD), 'holdout.lock')).read().split()[0],
          'scored_files': len(shown), 'missing_files': len(missing), 'missing_ids': missing[:50],
          'not_complete': sum(1 for v in shown.values() if v['status'] not in ('complete',)),
          'labels': {l: {route: score(l, route) for route in ('short', 'long', 'all')} for l in hold['labels']}}
json.dump(report, open(OUT, 'w'), indent=1)
for l, v in report['labels'].items():
    for route in ('short', 'long'):
        s = v[route]; print(f"{l:12s} {route:5s} +{s['support_pos']:3d}/-{s['support_neg']:4d}  strict P {s['strict']['precision']} R {s['strict']['recall']}  shown P {s['shown']['precision']} R {s['shown']['recall']}  abstain +{s['abstentions_pos']}/-{s['abstentions_neg']}  unlabelled {s['fires_on_unlabelled']}")
print(f"scored {len(shown)}, missing {len(missing)}")
