import json,sys
# Usage: python3 select.py modes-fsd50k-eval.json [modes]   (modes default 'sole'; 'sole,either,both' shows the held picks)
MODES=(sys.argv[2] if len(sys.argv)>2 else 'sole').split(',')
d=json.load(open(sys.argv[1]))['table']
def pr(c):
  p=c['tp']/(c['tp']+c['fp']) if c['tp']+c['fp'] else 0; r=c['tp']/(c['tp']+c['fn']) if c['tp']+c['fn'] else 0; return p,r
ok=lambda c:(lambda p,r:p>=.6 and r>=.3)(*pr(c))
f1=lambda c:(lambda p,r:2*p*r/(p+r) if p+r else 0)(*pr(c))
picks={}
for k in sorted(d['default']['pick']):
  base=d['default']['pick'][k]
  best=max(MODES,key=lambda m:(ok(d[m]['pick'][k]),f1(d[m]['pick'][k])))
  c=d[best]['pick'][k]
  better = ok(c) and (not ok(base) or f1(c)>f1(base)+0.01)
  if better: picks[k]=best; print(f"{k:26s} {best:7s} pick F1 {f1(base):.3f}->{f1(c):.3f} pass {ok(base)}->{ok(c)} | check {ok(d['default']['check'][k])}->{ok(d[best]['check'][k])} F1 {f1(d['default']['check'][k]):.3f}->{f1(d[best]['check'][k]):.3f}")
