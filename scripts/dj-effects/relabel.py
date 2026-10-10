"""Re-applies mine.py's tag rules from a labels file to the stored uploader tags of an existing manifest (renders keep
their labels). Usage: relabel.py <labels.json> <manifest in> <manifest out>"""
import json, re, sys
LAB, IN, OUT = sys.argv[1:4]
spec = json.load(open(LAB))
norm = lambda s: re.sub(r'[\s_\-]+', ' ', str(s).lower()).strip()
squash = lambda s: norm(s).replace(' ', '')
MUSIC = {norm(t) for t in spec['music']}
rules = []
for L in spec['labels']:
    terms = {norm(t) for t in L['tags']}
    rules.append({'label': L['label'], 'terms': terms | {squash(t) for t in terms}, 'phrases': {t for t in terms if ' ' in t},
                  'all': [{norm(t) for t in alt} for alt in L.get('all', [])],
                  'context': MUSIC if L.get('context') == 'music' else None, 'exclude': {norm(t) for t in L.get('exclude', [])}})
def labels_of(tagset, title):
    ttl = f' {norm(title)} '; out = []
    for r in rules:
        if tagset & r['exclude']: continue
        hit = bool(tagset & r['terms']) or any(f' {p} ' in ttl for p in r['phrases']) or (r['all'] and all(tagset & alt for alt in r['all']))
        if hit and (r['context'] is None or tagset & r['context']): out.append(r['label'])
    return out
m = json.load(open(IN)); changed = 0
for c in m['clips']:
    tagset = {norm(x) for x in (c.get('tags') or '').split(',') if x.strip()}; tagset |= {squash(x) for x in tagset}
    new = labels_of(tagset, c.get('title') or '')
    if set(new) != set(c['labels']):
        changed += 1; print(f"{c['split']:<8} {c['title'][:50]!r:<54} {c['labels']} -> {new}", file=sys.stderr)
    c['labels'] = new
json.dump(m, open(OUT, 'w')); print(changed, 'clips relabelled')
