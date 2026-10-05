"""Prints what one dataset round changed against the previous round, sound by sound."""
import json, sys
a, b = (json.load(open(p))['results'] for p in sys.argv[1:3])
A = {(r['kind'], r['name']): r for r in a}; Bm = {(r['kind'], r['name']): r for r in b}
f = lambda r: r.get('f1') if r and 'f1' in r else None
gain = [(k, f(A.get(k)), f(Bm[k])) for k in Bm if f(Bm[k]) is not None]
newp = [k[1] for k in Bm if Bm[k].get('passes') and not (A.get(k) or {}).get('passes')]
lost = [k[1] for k in A if A[k].get('passes') and not (Bm.get(k) or {}).get('passes')]
newc = [k[1] for k, x, y in gain if x is None]
both = [(k, x, y) for k, x, y in gain if x is not None]
up = sum(1 for _, x, y in both if y > x + .02); down = sum(1 for _, x, y in both if y < x - .02)
print(f"passing: {sum(r.get('passes', False) for r in a)} -> {sum(r.get('passes', False) for r in b)}   now passing: {newp or '-'}   stopped passing: {lost or '-'}")
print(f"of {len(both)} sounds tested both rounds: {up} better, {down} worse, {len(both)-up-down} about the same;  mean F1 {sum(x for _,x,_ in both)/len(both):.3f} -> {sum(y for _,_,y in both)/len(both):.3f}")
if newc: print(f"newly testable: {', '.join(f'{k[1]} ({Bm[k][chr(112)+chr(114)+chr(101)+chr(99)+chr(105)+chr(115)+chr(105)+chr(111)+chr(110)]*100:.0f}/{Bm[k][chr(114)+chr(101)+chr(99)+chr(97)+chr(108)+chr(108)]*100:.0f})' for k in [kk for kk,x,y in gain if x is None])}")
for k, x, y in sorted(both, key=lambda t: t[2] - t[1], reverse=True)[:5]:
    if y - x > .02: print(f"  + {k[1]:<18} {x:.2f} -> {y:.2f}")
for k, x, y in sorted(both, key=lambda t: t[2] - t[1])[:3]:
    if x - y > .02: print(f"  - {k[1]:<18} {x:.2f} -> {y:.2f}")
