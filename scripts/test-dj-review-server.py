"""Exercise real local upload/category/review APIs using isolated review data."""
import importlib.util, json, math, struct, tempfile, threading, time, urllib.request, urllib.error, wave
from pathlib import Path
spec=importlib.util.spec_from_file_location('review_server',Path(__file__).with_name('dj-review-server.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='dj-review-api-') as folder:
    # Generate a fixture instead of depending on someone's private review corpus.
    fixture=Path(folder)/'fixture.wav'
    with wave.open(str(fixture), 'wb') as audio:
        audio.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
        audio.writeframes(b''.join(struct.pack('<h', round(8000 * math.sin(i * 2 * math.pi * 440 / 22050))) for i in range(22050 * 3)))
    item={'id':'fixture-1','title':'Synthetic tone','seconds':3,'preview':'fixture.wav','reviewed':False}
    module.DATA=Path(folder)/'review';module.write(module.DATA/'manifest.json',{'version':1,'items':[item]})
    server=module.ThreadingHTTPServer(('127.0.0.1',0),module.Handler)
    module.PORT=server.server_address[1];module.ORIGIN=f'http://127.0.0.1:{module.PORT}'
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    def request(path,data=None,token=True,raw=False):
        headers={}
        if data is not None:
            headers={'Origin':module.ORIGIN,'Content-Type':'application/json'}
            if token:headers['X-Review-Token']=module.TOKEN
        req=urllib.request.Request(module.ORIGIN+path,data=data if raw else json.dumps(data).encode() if data is not None else None,headers=headers)
        try:
            with urllib.request.urlopen(req) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)
    try:
        assert request('/api/state')[0]==200
        assert request('/api/categories',{},token=False)[0]==403
        category={'group':'production','label':'test breath texture','description':'A human breath repeated with a short echo.','source':'breath'}
        assert request('/api/categories',category)[0]==201
        assert request('/api/categories',category)[0]==400
        labels={'source':['breath'],'production':['vocal breath'],'character':[]}
        assert request('/api/reviews',{'id':item['id'],'review':{'confirmed':True,'labels':labels}})[0]==200
        assert module.read(module.DATA/'reviews.json')[item['id']]['confirmed']
        assert not module.is_training_confirmation(module.read(module.DATA/'reviews.json')[item['id']])
        assert request('/api/reviews',{'id':item['id'],'review':{'confirmed':True,'labels':labels,'provenance':'explicit human confirmation'}})[0]==200
        assert module.is_training_confirmation(module.read(module.DATA/'reviews.json')[item['id']])
        assert request('/api/reviews',{'id':item['id'],'review':{'confirmed':True,'labels':labels,'provenance':'assistant review'}})[0]==200
        assert module.read(module.DATA/'reviews.json')[item['id']]['provenance']=='assistant review'
        assert not module.is_training_confirmation(module.read(module.DATA/'reviews.json')[item['id']])
        assert module.is_training_confirmation({'confirmed':True,'provenance':'explicit human confirmation'})
        assert not module.is_training_confirmation({'confirmed':True})

        # Missing category snapshots mean only selected labels were assessed.
        positive_keys=['source:breath','production:vocal breath']
        saved=module.read(module.DATA/'reviews.json')[item['id']]
        assert sorted(saved['knownLabels'])==sorted(positive_keys)
        scoped={'confirmed':True,'labels':labels,'provenance':'explicit human confirmation','knownLabels':positive_keys+['production:kick'],'decisions':{'production:kick':'absent','production:snare':'unsure'}}
        assert request('/api/reviews',{'id':item['id'],'review':scoped})[0]==200
        saved=module.read(module.DATA/'reviews.json')[item['id']]
        assert saved['decisions']['production:snare']=='unsure'
        assert 'production:snare' not in saved['knownLabels']
        invalid={**scoped,'knownLabels':scoped['knownLabels']+['production:snare']}
        assert request('/api/reviews',{'id':item['id'],'review':invalid})[0]==400
        invalid={**scoped,'decisions':{'source:breath':'absent'}}
        assert request('/api/reviews',{'id':item['id'],'review':invalid})[0]==400
        draft={**scoped,'confirmed':False,'reviewStatus':'uncertain'}
        assert request('/api/reviews',{'id':item['id'],'review':draft})[0]==200
        assert not module.is_training_confirmation(module.read(module.DATA/'reviews.json')[item['id']])

        assert request('/api/sounds?name=bad.exe',b'bad',raw=True)[0]==400
        code,job=request('/api/sounds?name=synthetic-tone.wav',fixture.read_bytes(),raw=True)
        assert code==202
        deadline=time.time()+90
        while time.time()<deadline:
            _,result=request('/api/jobs/'+job['jobId'])
            if result['state']!='running':break
            time.sleep(.2)
        assert result['state']=='complete',(result,(module.DATA/'upload.log').read_text() if (module.DATA/'upload.log').exists() else '')
        items=module.read(module.DATA/'manifest.json')['items']
        assert len(items)==2
        assert -20<items[1]['properties']['rmsDbfs']<-10
        assert items[1]['properties']['sampleRate']==48000
        print('PASS: local API protection, category creation, duplicate rejection, durable reviews, and real audio upload/inference.')
    finally:server.shutdown();server.server_close()
