# Piano P/R by half and clip-length band from app-path-whatif.ts outputs (base/det/both/either.json) next to the cache shards.
# Run from that private folder: python3 -I bands.py [source:piano]. Keep its inputs and outputs private (judge-set model outputs).
import json,glob,sys
recs={}
for f in sorted(glob.glob('items-files*.jsonl')):
  for l in open(f):
    if not l.strip(): continue
    r=json.loads(l); recs[r['id']]=(r['group'],r['duration'],r['labels'])
def fnv(s):
  h=2166136261
  for c in s: h^=ord(c); h=(h*16777619)&0xffffffff
  return h
def band(d): return '<10' if d<10-1e-3 else '10-20' if d<20-1e-6 else '20-30' if d<=30+1e-6 else '>30'
KEY=sys.argv[1] if len(sys.argv)>1 else 'source:piano'
for name in ['base','det','both','either']:
  pc=json.load(open(name+'.json'))['perClip']
  T={}
  for cid,(g,d,lab) in recs.items():
    if KEY not in lab: continue
    y=lab[KEY]; s=KEY in pc.get(cid,[])
    for p in ['pick' if fnv(g)%2==0 else 'check','all',band(d),('pick' if fnv(g)%2==0 else 'check')+band(d)]:
      c=T.setdefault(p,[0,0,0])
      if y and s: c[0]+=1
      elif s: c[1]+=1
      elif y: c[2]+=1
  def fmt(c):
    tp,fp,fn=c; P=tp/(tp+fp) if tp+fp else float('nan'); R=tp/(tp+fn) if tp+fn else float('nan'); F=2*tp/(2*tp+fp+fn) if tp else 0
    return f"P{P:.3f} R{R:.3f} F{F:.3f} ({tp}/{fp}/{fn})"
  print(name)
  for p in ['pick','check','all','<10','10-20','20-30','>30','pick10-20','check10-20']: print('  ',p,fmt(T.get(p,[0,0,0])))
