"""Neighbour (reference-sound) heads for the failing CLAP-side tags, cutoffs from TRAINING data only.
Cutoff = the q-quantile of out-of-fold margins of training clips WITHOUT the tag (q=0.99 -> ~1% training false alarms).
Banks: up to M random training positives (round 11 pool, exclude-list filtered, split=train, no clip within cosine 0.995
of any test clip), shared background B. Vectors int8 exactly as stored in learned.json. Never reads a test label.
Usage: python3 -I build_nb.py <q> <out learned.json> tag1,tag2,..."""
import base64, csv, glob, json, sys
import numpy as np
q=float(sys.argv[1]); outp=sys.argv[2]; TAGS=sys.argv[3].split(',')
import os; M,B,K=200,int(os.environ.get('B',3000)),5; rng=np.random.default_rng(0)
REPO='/home/user/document-graph-explorer'
cat={c['label']:c['group'] for c in json.load(open(f'{REPO}/src/audio/djCatalog.json'))['categories']}
z=np.load('/var/tmp/rb/pool/pool.npz')
keepids={r['pool_id'] for r in csv.DictReader(open('/var/tmp/rb/pool/pool-filtered.csv')) if r.get('split','train') in ('train','')}
keep=np.array([i in keepids for i in z['pool_id']])
X=z['clap'].astype(np.float32); X/=np.maximum(np.linalg.norm(X,axis=1,keepdims=True),1e-8)
q8i=lambda V:np.clip(np.round(V/np.abs(V).max(1,keepdims=True)*127),-127,127).astype(np.int8)
Xq=q8i(X).astype(np.float32); Xq/=np.linalg.norm(Xq,axis=1,keepdims=True)   # what the app decodes
emb=[]
for f in glob.glob('/mnt/project-files/reports/clap-heads-2026-10-29/private/emb/*/*.jsonl'):
    for l in open(f):
        if l.strip(): emb.append(json.loads(l)['embedding'])
TE=np.array(emb,np.float32); TE/=np.linalg.norm(TE,axis=1,keepdims=True); near=np.zeros(len(X),bool)
for a in range(0,len(X),4000): near[a:a+4000]=(X[a:a+4000]@TE.T).max(1)>0.995
keep&=~near; print('pool kept',keep.sum(),'near test dropped',near.sum())
Ptags=[set(str(s).split('|')) for s in z['tags']]
bg=rng.choice(np.where(keep)[0],B,replace=False); bgset=set(bg.tolist())
topk=lambda S,k:np.sort(S,1)[:,-k:].mean(1)
heads=[]; info={}
for tag in TAGS:
    pos=np.where(keep&np.array([tag in s for s in Ptags]))[0]
    if len(pos)<10 or tag not in cat: info[tag]={'skip':f'{len(pos)} training clips'}; continue
    skip=[k for k,j in enumerate(bg) if tag in Ptags[j]]; bgt=Xq[[j for k,j in enumerate(bg) if k not in set(skip)]]
    bank=rng.choice(pos,min(M,len(pos)),replace=False)
    neg=np.array([i for i in np.where(keep)[0] if tag not in Ptags[i] and i not in bgset]); neg=rng.choice(neg,min(20000,len(neg)),replace=False)
    mn=topk(Xq[neg]@Xq[bank].T,K)-topk(Xq[neg]@bgt.T,K); c=float(np.quantile(mn,q))
    # out-of-fold recall on training positives (5 folds, bank from the other folds)
    pf=np.array_split(rng.permutation(pos),5); rec=[]
    for f in range(5):
        oth=np.concatenate([pf[g] for g in range(5) if g!=f]); b=rng.choice(oth,min(M,len(oth)),replace=False)
        rec.append(topk(Xq[pf[f]]@Xq[b].T,K)-topk(Xq[pf[f]]@bgt.T,K)>=c)
    info[tag]={'trainPos':int(len(pos)),'bank':int(len(bank)),'cutoff':round(c,5),'trainOOFRecall':round(float(np.concatenate(rec).mean()),3)}
    heads.append({'group':cat[tag],'label':tag,'examples':base64.b64encode(q8i(X[bank]).tobytes()).decode(),'skipBackground':skip,'cutoff':round(c,5)})
m=json.load(open(f'{REPO}/public/sound-model/learned.json'))
m['neighbours']={'k':K,'background':base64.b64encode(q8i(X[bg]).tobytes()).decode(),'heads':heads}
m['revision']=m['revision'].split('+')[0]+'+refblend-2026-10-31'
json.dump(m,open(outp,'w'),separators=(',',':')); json.dump(info,open(outp+'.info.json','w'),indent=1)
for t,v in info.items(): print(t,v)
print(len(heads),'heads, file MB',round(len(json.dumps(m,separators=(',',':')))/1e6,2))
