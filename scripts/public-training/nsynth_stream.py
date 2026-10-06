import tarfile, hashlib, re, sys, os, collections, urllib.request
OUT='/home/user/data/nsynth-train'
h=lambda *p: hashlib.sha256('|'.join(map(str,p)).encode()).hexdigest()
per=collections.Counter(); kept=0
req=urllib.request.urlopen('http://download.magenta.tensorflow.org/datasets/nsynth/nsynth-train.jsonwav.tar.gz')
tf=tarfile.open(fileobj=req, mode='r|gz')
for mem in tf:
    if mem.name.endswith('examples.json'):
        open(f'{OUT}/examples.json','wb').write(tf.extractfile(mem).read()); print('got examples.json', flush=True); continue
    m=re.search(r'/audio/((\w+?)_(\w+?)_(\d+)-(\d+)-(\d+))\.wav$', mem.name)
    if not m: continue
    name,fam,src,inst,pitch,vel=m.groups(); pitch,vel=int(pitch),int(vel); instr=f'{fam}_{src}_{inst}'
    if not (36<=pitch<=84 and vel>=50) or int(h('nsynth-train',name)[:8],16)%25 or per[instr]>=8: continue
    per[instr]+=1; kept+=1
    open(f'{OUT}/{name}.wav','wb').write(tf.extractfile(mem).read())
    if kept%500==0: print(kept, flush=True)
print('done', kept, len(per), flush=True)
