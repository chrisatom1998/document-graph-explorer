"""Choose FSD50K clips: benchmark test (eval) + calibration (dev) by manifest id, and the training pool
(dev clips 0.25-2.3 s, CC0 / CC BY 3.0 only, uploaders not in calibration or test, 30 per uploader). Run from the work dir
after rangezip.py has listed both central directories (eval-members.json, dev-members.json). Writes want-*.txt and fsd-plan.json."""
import json, re, hashlib, collections, csv
R='/home/user/document-graph-explorer/docs/evaluations/short-clips-2026-10-04'
m=json.load(open(f'{R}/manifest.json')); meta=json.load(open(f'{R}/item-meta.json'))
h=lambda *p: hashlib.sha256('|'.join(map(str,p)).encode()).hexdigest()
ev=json.load(open('eval-members.json')); dv=json.load(open('dev-members.json'))
info=json.load(open('/home/user/data/fsd50k-meta/FSD50K.metadata/dev_clips_info_FSD50K.json'))
einfo=json.load(open('/home/user/data/fsd50k-meta/FSD50K.metadata/eval_clips_info_FSD50K.json'))
bench={'eval':[], 'dev':[]}; idmap={}
for i in m['items']:
    s=i['source']
    if s.startswith('FSD50K'):
        part,fid=re.match(r'FSD50K (\w+) clip (\d+)',s).groups(); bench[part].append(fid+'.wav'); idmap[fid]=i['id']
print({k:len(v) for k,v in bench.items()})
test_up={einfo[f[:-4]]['uploader'] for f in bench['eval']}
cal_up={info[f[:-4]]['uploader'] for f in bench['dev']}
print('dev uploaders overlapping eval test uploaders:', len({v['uploader'] for v in info.values()} & test_up))
OK={'http://creativecommons.org/publicdomain/zero/1.0/','http://creativecommons.org/licenses/by/3.0/'}
per=collections.Counter(); train=[]; lic=collections.Counter()
for name,usize in sorted(dv.items(), key=lambda kv: h('order',kv[0])):
    if not name: continue
    fid=name[:-4]; d=(usize-44)/88200
    if not (0.25<=d<=2.3): continue
    up=info[fid]['uploader']
    if up in cal_up or up in test_up or int(h('fsd-up',up)[:8],16)%5==0: continue
    lic[info[fid]['license']]+=1
    if info[fid]['license'] not in OK: continue
    if per[up]>=30: continue
    per[up]+=1; train.append(name)
print('train clips', len(train), 'uploaders', len(per), lic)
open('want-eval.txt','w').write('\n'.join(bench['eval'])); open('want-dev.txt','w').write('\n'.join(bench['dev']+train))
json.dump({'idmap':idmap,'train':train}, open('fsd-plan.json','w'))
