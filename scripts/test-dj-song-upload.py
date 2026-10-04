"""Real song decoding/inference with isolated review data; never edits live reviews."""
import importlib.util, tempfile, subprocess, hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('review_server',Path(__file__).with_name('dj-review-server.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='song-review-') as folder:
    m.DATA=Path(folder)
    song=m.DATA/'test-song.wav'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=25','-y',str(song)],check=True)
    digest=hashlib.sha256(song.read_bytes()).hexdigest()
    result=m.process_song(song,'Test song.wav',digest,print)
    items=m.read(m.DATA/'manifest.json')['items']
    assert result['sections']==2 and len(items)==2
    assert [i['startSeconds'] for i in items]==[0,15]
    assert all(i['songId']==digest and i['durationSeconds']==25 and len(i['embedding'])==512 for i in items)
    assert all((m.DATA/i['preview']).stat().st_size>100 for i in items)
    review={'confirmed':True,'labels':{'source':['synthesizer'],'production':[],'character':[]},'provenance':'explicit human confirmation'}
    m.write(m.DATA/'reviews.json',{items[0]['id']:review})
    items[0]['automaticTags']=[]
    items[0]['analysisVersion']=0
    m.write(m.DATA/'manifest.json',{'items':items})
    m.process_song(song,'Test song.wav',digest,print)
    assert len(m.read(m.DATA/'manifest.json')['items'])==2
    assert m.read(m.DATA/'reviews.json')[items[0]['id']]==review
    assert all(i['analysisVersion']==2 and 'instrumentCandidates' in i for i in m.read(m.DATA/'manifest.json')['items'])
    print('PASS: real multi-section song inference, timestamps, previews, shared song identity, deduplication and no automatic confirmation.')
