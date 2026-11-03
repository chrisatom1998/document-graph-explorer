"""Training-only reference pool: round 11 CLAP features + labels (run9, empty-tags, commercial), as build_pool.py (Oct 11)."""
import csv, glob, os, numpy as np
csv.field_size_limit(1 << 30)
F='/var/tmp/rb/feat'; OUT='/var/tmp/rb/pool'
man={}
def add(prefix,path,key='file',tagcol='tags'):
    for r in csv.DictReader(open(path)): man[prefix+r[key]]=(r,r.get(tagcol) or '')
for p in glob.glob(f'{F}/run9/manifests/*.csv'): add(os.path.basename(p)[len('run9__v1__'):-4]+'/',p)
for p in glob.glob(f'{F}/emptytags/manifests/*.csv'):
    add(os.path.basename(p)[len('empty-tags__v1__'):-4].replace('freesound__','')+'/',p)
for r in csv.DictReader(open('/mnt/project-files/datasets/commercial-train/labels/labels.csv')): man['commercial/'+r['path']]=(r,r['present_tags'])
ids,clap,tags,rows,miss=[],[],[],[],0
for f in sorted(glob.glob(f'{F}/*/*.npz')):
    z=np.load(f)
    for i,k in enumerate(z['id']):
        m=man.get(str(k))
        if m is None: miss+=1; continue
        r,t=m; tl=sorted({x.strip() for x in t.replace('|',';').split(';') if x.strip()})
        if not tl: continue
        ids.append(str(k)); clap.append(z['clap'][i].astype(np.float32)); tags.append('|'.join(tl)); rows.append(dict(r,pool_id=str(k)))
print('pool',len(ids),'unmatched',miss)
np.savez(f'{OUT}/pool.npz',pool_id=np.array(ids),clap=np.stack(clap),tags=np.array(tags))
cols=sorted({c for r in rows for c in r})
with open(f'{OUT}/pool.csv','w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=['pool_id']+[c for c in cols if c!='pool_id']); w.writeheader(); w.writerows(rows)
