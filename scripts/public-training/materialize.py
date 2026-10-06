"""Recreate the frozen short-clip benchmark audio (test + calibration) from public sources, by manifest id."""
import json, re, hashlib, subprocess, tarfile, zipfile, io, csv, os, shutil, wave
R='/home/user/document-graph-explorer/docs/evaluations/short-clips-2026-10-04'
A='/home/user/media/dj-training-fingerprints/short-clips/bench-audio'
os.makedirs(A, exist_ok=True)
m=json.load(open(f'{R}/manifest.json')); meta=json.load(open(f'{R}/item-meta.json'))
h=lambda *p: hashlib.sha256('|'.join(map(str,p)).encode()).hexdigest()
def crop(b, start, dur, fade=0.01):
    return subprocess.run(['ffmpeg','-nostdin','-v','error','-i','pipe:0','-ss',f'{start:.4f}','-t',f'{dur:.4f}','-af',f'afade=t=out:st={max(0,dur-fade):.4f}:d={fade}','-ac','1','-c:a','pcm_s16le','-f','wav','pipe:1'],input=b,capture_output=True,check=True).stdout
items={i['id']:i for i in m['items']}
miss=[]; n=0
for iid,i in items.items():
    s=i['source']; dest=f'{A}/{iid}.wav'
    if os.path.exists(dest): continue
    if s.startswith('FSD50K'):
        part,fid=re.match(r'FSD50K (\w+) clip (\d+)',s).groups()
        src=f'/home/user/data/fsd-{part}/{fid}.wav'
        if not os.path.exists(src): miss.append(iid); continue
        assert 'sc-'+h('fsd50k',fid)[:16]==iid; shutil.copy(src,dest); n+=1
print('fsd copied',n,'missing',len(miss))
# NSynth test
want={}
for iid,i in items.items():
    mm=re.match(r'NSynth (\S+) note (\S+) ',i['source'])
    if mm: want[f'{mm.group(1)}/audio/{mm.group(2)}.wav']=(iid,mm.group(2),i['end'])
tf=tarfile.open('/home/user/data/nsynth-test.jsonwav.tar.gz'); k=0
for mem in tf:
    w=want.get(mem.name)
    if not w: continue
    iid,name,secs=w; assert 'sc-'+h('nsynth',name)[:16]==iid
    if not os.path.exists(f'{A}/{iid}.wav'): open(f'{A}/{iid}.wav','wb').write(crop(tf.extractfile(mem).read(),0,secs))
    k+=1
print('nsynth',k,'of',len(want))
# AVP
z=zipfile.ZipFile('/home/user/data/avp.zip'); k=0; tot=0
for iid,i in items.items():
    mm=re.match(r'AVP (\S+) onset',i['source'])
    if not mm: continue
    tot+=1
    if os.path.exists(f'{A}/{iid}.wav'): k+=1; continue
    data=crop(z.read(mm.group(1)), i['start'], i['end']-i['start']); open(f'{A}/{iid}.wav','wb').write(data); k+=1
print('avp',k,'of',tot)
print('total files', len(os.listdir(A)), 'manifest', len(items))
