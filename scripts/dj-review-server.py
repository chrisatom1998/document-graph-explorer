#!/usr/bin/env python3
"""Local-only review service. Run from the project root: python3 scripts/dj-review-server.py."""
import hashlib, json, os, re, secrets, shutil, subprocess, threading, time, tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from dj_pack_import import PACKS, download_pack, stage_archive, metadata

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('DJ_REVIEW_DATA', ROOT / 'artifacts/music-evaluation/review-start')).resolve()
UI = ROOT / 'scripts/dj-review-ui'
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.RLock()
BUSY = threading.Lock()
JOBS = {}
PORT = int(os.environ.get('DJ_REVIEW_PORT', '8766'))
# Check sets (listening tests of disputed clips) save labels but must never rebuild the shipped model.
NO_APPLY = os.environ.get('DJ_REVIEW_NO_APPLY') == '1'
ORIGIN = f'http://127.0.0.1:{PORT}'
GROUPS = ('source', 'production', 'character')
HUMAN_CONFIRMATION = 'explicit human confirmation'
ASSISTANT_REVIEW = 'assistant review'

def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2) + '\n')
    tmp.replace(path)

def categories():
    base = read(ROOT/'src/audio/djCatalog.json')['categories']
    return base + read(DATA/'custom-categories.json', [])

def state():
    manifest = read(DATA/'manifest.json', {'version':1,'items':[],'scope':'First ten seconds per clip.'})
    return {'manifest':manifest, 'catalog':{'categories':categories()}, 'reviews':read(DATA/'reviews.json', {}), 'token':TOKEN, 'lastApplied':read(DATA/'last-applied.json'), 'pendingCategories':len(read(DATA/'custom-categories.json', [])), 'packImportVersion':1, 'busy':BUSY.locked()}

def validate_review(value):
    if not isinstance(value, dict) or not isinstance(value.get('labels'), dict) or not isinstance(value.get('confirmed'), bool):
        raise ValueError('Invalid review.')
    allowed = {g:{c['label'] for c in categories() if c['group']==g} for g in GROUPS}
    labels = {}
    for g in GROUPS:
        values = value['labels'].get(g)
        if not isinstance(values,list) or any(not isinstance(v,str) or v not in allowed[g] for v in values):
            raise ValueError('Unknown label in review.')
        labels[g] = list(dict.fromkeys(values))
    known = value.get('knownLabels', [g+':'+v for g in GROUPS for v in allowed[g]])
    if not isinstance(known,list) or len(known)>2000 or any(not isinstance(v,str) or ':' not in v or v.split(':',1)[0] not in GROUPS or v.split(':',1)[1] not in allowed[v.split(':',1)[0]] for v in known):
        raise ValueError('Invalid category snapshot.')
    if any(g+':'+v not in known for g in GROUPS for v in labels[g]):
        raise ValueError('Selected labels must be in the review category snapshot.')
    return {'labels':labels,'confirmed':value['confirmed'],'knownLabels':known,'reviewedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'provenance':(value.get('provenance') if value.get('provenance') in (ASSISTANT_REVIEW,HUMAN_CONFIRMATION) else 'unverified review') if value['confirmed'] else 'draft'}

def is_training_confirmation(review):
    """Only a directly recorded human confirmation can create training data."""
    return isinstance(review, dict) and review.get('confirmed') is True and review.get('provenance') == HUMAN_CONFIRMATION

def run_job(fn):
    if not BUSY.acquire(False):
        raise ValueError('Another upload or model update is running. Wait for it to finish.')
    job_id=secrets.token_hex(12); JOBS[job_id]={'state':'running','message':'Starting'}
    def run():
        try:
            result=fn(lambda message: JOBS[job_id].update(message=message))
            JOBS[job_id].update(state='complete',result=result,message='Complete')
        except Exception as error:
            JOBS[job_id].update(state='failed',message=str(error))
        finally:
            BUSY.release()
    threading.Thread(target=run,daemon=True).start()
    return {'jobId':job_id}

def command(args, log, timeout=600):
    result=subprocess.run(args,cwd=ROOT,stdout=log,stderr=log,timeout=timeout)
    if result.returncode:
        raise RuntimeError('Processing failed. Details were saved in the local job log; your previous model remains available.')

def process_upload(path, name, digest, progress):
    preview=DATA/'audio'/f'{digest}.wav'; preview.parent.mkdir(parents=True,exist_ok=True)
    output=DATA/f'upload-{digest}.json'
    with (DATA/'upload.log').open('w') as log:
        progress('Decoding the first ten seconds')
        command(['ffmpeg','-v','error','-y','-i',str(path),'-t','10','-ac','1','-ar','22050',str(preview)],log,120)
        progress('Analyzing the sound locally')
        command(['npx','vite-node','src/dev/classifyDjAudio.ts','--','--output',str(output),str(path)],log)
    result=read(output)['results'][0]
    if len(result['embedding'])!=512:
        raise ValueError('This clip is silent or could not produce audio features. Choose an audible sound.')
    item={'id':digest,'title':name,'originalPath':str(path),'preview':'audio/'+preview.name,'seconds':result['seconds'],'folder':'Added sounds','proposedLabels':{g:[] for g in GROUPS},'labelProvenance':'unreviewed upload','hintReasons':[],'automaticTags':result['tags'],'embedding':result['embedding'],'reviewed':False}
    with LOCK:
        manifest=read(DATA/'manifest.json', {'version':1,'items':[],'scope':'First ten seconds per clip.'})
        if not any(i['id']==digest for i in manifest['items']):manifest['items'].append(item)
        write(DATA/'manifest.json',manifest)
    return {'itemId':digest,'name':name}

def process_song(path, name, digest, progress):
    output=DATA/f'song-{digest}.json'
    DATA.joinpath('audio').mkdir(parents=True, exist_ok=True)
    with (DATA/'upload.log').open('w') as log:
        progress('Analyzing up to twelve sections across the song')
        command(['npx','vite-node','src/dev/classifyDjAudio.ts','--','--song','--output',str(output),str(path)],log,1200)
        items=[]
        for result in read(output)['results']:
            if len(result.get('embedding',[])) != 512:continue
            start=result['start']
            item_id=hashlib.sha256(f'{digest}:song:{start:.6f}'.encode()).hexdigest()
            preview=DATA/'audio'/f'{item_id}.wav'
            command(['ffmpeg','-v','error','-y','-ss',str(start),'-i',str(path),'-t','10','-ac','1','-ar','22050',str(preview)],log,120)
            items.append({'id':item_id,'title':f"{name} · {start:.1f}–{start+result['seconds']:.1f}s",'originalPath':str(path),'preview':'audio/'+preview.name,'seconds':result['seconds'],'songId':digest,'startSeconds':start,'durationSeconds':result['duration'],'folder':'Song excerpts','proposedLabels':{g:[] for g in GROUPS},'labelProvenance':'unreviewed song excerpt','hintReasons':[],'automaticTags':result['tags'],'instrumentCandidates':result.get('instrumentCandidates',[]),'analysisVersion':2,'embedding':result['embedding'],'reviewed':False})
    if not items:raise ValueError('No audible sections could be analyzed in this song.')
    with LOCK:
        manifest=read(DATA/'manifest.json',{'version':1,'items':[]})
        refreshed={i['id']:i for i in items}
        ids={i['id'] for i in manifest['items']}
        # Refresh model predictions on re-import; human reviews live separately and remain untouched.
        manifest['items']=[{**i, **refreshed[i['id']]} if i['id'] in refreshed else i for i in manifest['items']]
        manifest['items'].extend(i for i in items if i['id'] not in ids)
        manifest['scope']='Labels cover each displayed excerpt only; song excerpts sample the recording.'
        write(DATA/'manifest.json',manifest)
    return {'itemId':items[0]['id'],'itemIds':[i['id'] for i in items],'name':name,'sections':len(items)}

def process_pack(archive, info, progress):
    progress('Reading pack and retaining license evidence')
    sounds = stage_archive(archive, DATA, info)
    with LOCK:
        existing = {i['id'] for i in read(DATA/'manifest.json', {'items':[]})['items']}
    seen = set(existing)
    pending = []
    skipped = 0
    failures = []
    for sound in sounds:
        if sound['id'] in seen:
            skipped += 1
        else:
            seen.add(sound['id'])
            pending.append(sound)
    DATA.joinpath('audio').mkdir(parents=True, exist_ok=True)
    ready = []
    with tempfile.TemporaryDirectory(prefix='pack-analysis-', dir=DATA) as folder:
        output = Path(folder)/'analysis.json'
        with (DATA/'pack-import.log').open('w') as log:
            for index, sound in enumerate(pending):
                progress(f"Preparing {index+1}/{len(pending)}: {sound['title']}")
                preview = DATA/'audio'/f"{sound['id']}.wav"
                try:
                    command(['ffmpeg','-v','error','-y','-i',str(sound['path']),'-t','10','-ac','1','-ar','22050',str(preview)],log,120)
                    ready.append(sound)
                except Exception:
                    failures.append({'name':sound['title'], 'reason':'Audio could not be decoded'})
            if ready:
                progress(f'Analyzing {len(ready)} sounds locally; larger packs can take several minutes')
                command(['npx','vite-node','src/dev/classifyDjAudio.ts','--','--output',str(output)]+[str(s['path']) for s in ready],log,1200)
                results = {r['file']:r for r in read(output)['results']}
            else:
                results = {}
        added = []
        with LOCK:
            manifest = read(DATA/'manifest.json', {'version':1,'items':[],'scope':'First ten seconds per clip.'})
            ids = {i['id'] for i in manifest['items']}
            for sound in ready:
                result = results.get(str(sound['path']), {})
                if len(result.get('embedding', [])) != 512:
                    failures.append({'name':sound['title'], 'reason':'Silent audio or no usable features'})
                    continue
                if sound['id'] in ids:
                    skipped += 1
                    continue
                ids.add(sound['id'])
                manifest['items'].append({'id':sound['id'],'title':sound['title'],'originalPath':str(sound['path']), 'preview':f"audio/{sound['id']}.wav", 'seconds':result['seconds'], 'folder':info['name'], 'proposedLabels':{g:[] for g in GROUPS}, 'labelProvenance':'unreviewed pack import', 'hintReasons':[], 'automaticTags':result['tags'], 'embedding':result['embedding'], 'reviewed':False, 'packSource':sound['packSource']})
                added.append(sound['id'])
            write(DATA/'manifest.json',manifest)
    return {'added':len(added),'skipped':skipped,'failed':failures,'itemIds':added,'name':info['name']}

def import_download(pack_id, progress):
    DATA.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pack-download-',dir=DATA) as folder:
        archive = Path(folder)/'download.archive'
        progress('Downloading pack from its publisher')
        info = download_pack(pack_id, archive)
        return process_pack(archive, info, progress)

def import_uploaded(archive, info, progress):
    try:
        return process_pack(archive, info, progress)
    finally:
        archive.unlink(missing_ok=True)

def apply_model(progress):
    with LOCK:
        snapshot=state()
        confirmed={k:v for k,v in snapshot['reviews'].items() if is_training_confirmation(v)}
        pending=read(DATA/'custom-categories.json', [])
    if not confirmed and not pending:raise ValueError('Confirm a clip or add a category first.')
    directory=DATA/'updates'/time.strftime('%Y%m%d-%H%M%S')
    directory.mkdir(parents=True,exist_ok=False)
    request={'reviews':confirmed,'items':snapshot['manifest']['items'],'categories':pending}
    write(directory/'request.json', request)
    progress('Building the local recognition update')
    with (directory/'apply.log').open('w') as log:
        command(['npx','vite-node','src/dev/applyDjReview.ts',str(directory/'request.json')],log,1200)
    result=read(directory/'result.json')
    with LOCK:
        # Only remove categories included in this update; preserve any later drafts.
        applied={(c['group'],c['label']) for c in pending}
        write(DATA/'custom-categories.json',[c for c in read(DATA/'custom-categories.json',[]) if (c['group'],c['label']) not in applied])
        write(DATA/'last-applied.json',result)
    progress('Local app build updated')
    return result

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(DATA),**kwargs)
    def log_message(self,*args):pass
    def json(self,data,status=200):
        raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.headers.get('Host')!=f'127.0.0.1:{PORT}':return self.json({'error':'Invalid host'},403)
        path=urlparse(self.path).path
        if path=='/api/state':
            with LOCK:return self.json(state())
        if path.startswith('/api/jobs/'):
            job=JOBS.get(path.rsplit('/',1)[-1]);return self.json(job or {'error':'Unknown job'},200 if job else 404)
        if path in ('/','/index.html','/review.js'):
            file=UI/('review.js' if path=='/review.js' else 'index.html');raw=file.read_bytes();self.send_response(200);self.send_header('Content-Type','text/javascript' if path=='/review.js' else 'text/html');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers();return self.wfile.write(raw)
        if re.fullmatch(r'/audio/[a-f0-9]+\.wav',path):return super().do_GET()
        return self.json({'error':'Not found'},404)
    def do_POST(self):
        if self.headers.get('Host')!=f'127.0.0.1:{PORT}' or self.headers.get('Origin')!=ORIGIN or self.headers.get('X-Review-Token')!=TOKEN:return self.json({'error':'Refresh the local review page before saving.'},403)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=100*1024*1024:raise ValueError('Request must be smaller than 100 MB.')
            path=urlparse(self.path).path
            if path=='/api/pack-archive':
                info=metadata({k:v[0] for k,v in parse_qs(urlparse(self.path).query).items()})
                DATA.mkdir(parents=True,exist_ok=True)
                handle=tempfile.NamedTemporaryFile(dir=DATA,prefix='incoming-pack-',delete=False)
                archive=Path(handle.name)
                try:
                    with handle:
                        remaining=size
                        while remaining:
                            chunk=self.rfile.read(min(65536,remaining))
                            if not chunk:raise ValueError('Incomplete archive upload.')
                            handle.write(chunk);remaining-=len(chunk)
                    job=run_job(lambda progress:import_uploaded(archive,info,progress))
                except Exception:
                    archive.unlink(missing_ok=True)
                    raise
                return self.json(job,202)
            if path=='/api/sounds':
                name=Path(unquote(parse_qs(urlparse(self.path).query).get('name',['sound.wav'])[0])).name
                extension=Path(name).suffix.lower()
                if extension not in ('.wav','.mp3','.ogg','.flac','.aiff','.m4a'):raise ValueError('Choose WAV, MP3, OGG, FLAC, AIFF or M4A.')
                raw=self.rfile.read(size);digest=hashlib.sha256(raw).hexdigest();upload=DATA/'uploads'/(digest+extension);upload.parent.mkdir(exist_ok=True)
                if not upload.exists():upload.write_bytes(raw)
                song_mode=parse_qs(urlparse(self.path).query).get('mode',['clip'])[0]=='song'
                processor=process_song if song_mode else process_upload
                return self.json(run_job(lambda progress:processor(upload,name,digest,progress)),202)
            if size>4*1024*1024:raise ValueError('Review request is too large.')
            data=json.loads(self.rfile.read(size))
            if path=='/api/packs':
                pack_id=data.get('packId')
                if not isinstance(pack_id,str) or pack_id not in PACKS:raise ValueError('Unknown downloadable pack.')
                return self.json(run_job(lambda progress:import_download(pack_id,progress)),202)
            if path=='/api/reviews':
                with LOCK:
                    ids={i['id'] for i in read(DATA/'manifest.json')['items']}
                    if data.get('id') not in ids:raise ValueError('Unknown clip.')
                    review=validate_review(data['review']);reviews=read(DATA/'reviews.json',{});reviews[data['id']]=review;write(DATA/'reviews.json',reviews)
                return self.json({'saved':True,'review':review})
            if path=='/api/categories':
                if BUSY.locked():raise ValueError('Wait for the current upload or model update before adding a category.')
                with LOCK:
                    group=data.get('group');label=str(data.get('label','')).strip().lower();description=str(data.get('description','')).strip()
                    if group not in GROUPS or not re.fullmatch(r'[a-z0-9][a-z0-9 /()&+\-]{1,63}',label) or len(description)<12 or len(description)>500:raise ValueError('Choose a group, a 2–64 character name, and a 12–500 character sound description.')
                    if any(c['label']==label or label in c['aliases'] for c in categories()):raise ValueError('That category or alias already exists.')
                    source=data.get('source') if group=='production' else None
                    if source and source not in {c['label'] for c in categories() if c['group']=='source'}:raise ValueError('Choose an existing sound source.')
                    custom=read(DATA/'custom-categories.json',[])
                    if len(categories())>=1000:raise ValueError('The local catalog has reached its 1,000-category limit.')
                    category={'group':group,'family':'custom-'+group,'label':label,'description':description,'source':source,'aliases':[],'recognition':'experimental','axis':'dj-custom-'+group}
                    custom.append(category);write(DATA/'custom-categories.json',custom)
                return self.json({'category':category},201)
            if path=='/api/apply':return self.json(run_job((lambda progress:{'skipped':'Check set: labels saved, model not rebuilt.'}) if NO_APPLY else apply_model),202)
            return self.json({'error':'Not found'},404)
        except (ValueError,KeyError,TypeError,json.JSONDecodeError) as error:return self.json({'error':str(error)},400)
        except Exception:return self.json({'error':'The local operation failed. Check the server log.'},500)

if __name__=='__main__':
    DATA.mkdir(parents=True,exist_ok=True)
    print(f'DJ review: {ORIGIN}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
