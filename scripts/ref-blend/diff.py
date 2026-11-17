import json,sys
b=json.load(open(sys.argv[1]))['tags']; q=json.load(open(sys.argv[2]))['tags']
fm=lambda v:' '.join(f"{n[:5]}:{s.get('P',0):.2f}/{s.get('R',0):.2f}({s.get('pos')})" for n,s in (v.get('sets') or {}).items() if s.get('pos',0)>=5)+(' FA!'+str(v.get('falseAlarmCapBreached')) if v.get('falseAlarmCapBreached') else '')
for t in sorted(set(b)|set(q)):
    x,y=b.get(t,{}),q.get(t,{})
    if x.get('pass60_30')!=y.get('pass60_30') or fm(x)!=fm(y):
        print(f"{t:18s} {str(x.get('pass60_30')):5s}->{str(y.get('pass60_30')):5s} | {fm(x)} || {fm(y)}")
