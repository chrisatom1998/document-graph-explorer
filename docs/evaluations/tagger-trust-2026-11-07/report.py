import json,sys
d=json.load(open(sys.argv[1]))['table']
pol=json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'../../../src/audio/taggerPolicy.json')))['tags']
keys=sorted(d['default']['pick'])
def pr(c):
  p=c['tp']/(c['tp']+c['fp']) if c['tp']+c['fp'] else 0; r=c['tp']/(c['tp']+c['fn']) if c['tp']+c['fn'] else 0
  return p,r
def ok(c): p,r=pr(c); return p>=.6 and r>=.3
def f1(c): p,r=pr(c); return 2*p*r/(p+r) if p+r else 0
for k in keys:
  row=[]
  for m in ['default','sole','either','both']:
    for h in ['pick','check']:
      c=d[m][h][k]; p,r=pr(c); row.append(f"{p:.2f}/{r:.2f}{'*' if ok(c) else ' '}")
  if len(set(row))>2: print(f"{k:28s}", ' | '.join(row))
