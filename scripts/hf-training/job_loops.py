"""HF Jobs driver for tempo-loops-v1: the tempo-v1 song data plus FSL10K loops with uploader BPMs.
Never trains on any FSL10K loop that has a listener annotation, nor on any loop by an uploader in the tempo judge set."""
import hashlib, json, os, subprocess, sys, tarfile, urllib.request, concurrent.futures, time, zipfile, collections, numpy as np
from huggingface_hub import HfApi, hf_hub_download
REPO = 'cmjatom/dge-key-tempo-train'; RUN = os.environ.get('RUN', 'tempo-loops-v1'); api = HfApi(); CAP = int(os.environ.get('CAP', 200))
W = '/work'; os.makedirs(f'{W}/audio', exist_ok=True); os.makedirs(f'{W}/out', exist_ok=True); os.chdir(W)
HERE = os.path.dirname(os.path.abspath(__file__))
for f in ('feats.py', 'train_tempo.py', 'build_labels.py'): os.system(f'cp {HERE}/{f} {W}/{f}')
t0 = time.time(); STAGE = os.environ.get('STAGE', 'all')
if STAGE == 'train':
    tgz = hf_hub_download(REPO, f'runs/{RUN}/prep/feats.tar', repo_type='dataset')
    subprocess.run(['tar', 'xf', tgz], check=True)
    for mode in os.environ.get('MODES', 'final').split():
        r = subprocess.run([sys.executable, 'train_tempo.py', mode, 'labels.json', 'out'], env={**os.environ, 'WORKERS': str(max(2, os.cpu_count() - 1))}, capture_output=True, text=True)
        print(r.stdout[-4000:], r.stderr[-4000:], flush=True); open(f'out/{mode}.log', 'w').write(r.stdout + r.stderr)
        if r.returncode: sys.exit(f'{mode} failed with exit code {r.returncode}; nothing uploaded')
        print(mode, 'done', f'{time.time()-t0:.0f}s', flush=True)
    api.upload_folder(folder_path='out', path_in_repo=f'runs/{RUN}', repo_id=REPO, repo_type='dataset'); print('uploaded', flush=True); sys.exit(0)
# FSL10K: start the 8.8 GB download (aria2c, 16 connections) in the background while songs download
dl = subprocess.Popen(['aria2c', '-q', '-x', '16', '-s', '16', '-k', '20M', '--max-tries=10', '--retry-wait=5', '-o', 'fsl.zip', 'https://zenodo.org/api/records/3967852/files/FSL10K.zip/content'])  # parallel ranges: one connection to Zenodo is throttled
subprocess.run([sys.executable, 'build_labels.py', 'tempo-labels.json'], check=True)
labels = json.load(open('tempo-labels.json'))
def get(d):
    p = f"audio/{d['stem']}.mp3"
    if os.path.exists(p): return p
    for u in d['urls']:
        for a in range(3):
            try:
                b = urllib.request.urlopen(u, timeout=60).read()
                if hashlib.md5(b).hexdigest() == d['md5']: open(p, 'wb').write(b); return p
                break
            except Exception: time.sleep(2 ** a)
    return None
with concurrent.futures.ThreadPoolExecutor(16) as ex: paths = list(ex.map(lambda d: get(d) if 'urls' in d else None, labels))
urllib.request.urlretrieve('https://huggingface.co/datasets/marsyas/gtzan/resolve/main/data/genres.tar.gz', 'gtzan.tgz')
with tarfile.open('gtzan.tgz') as t:
    want = {d['gtzan'] for d in labels if 'gtzan' in d}
    t.extractall('gz', members=[m for m in t.getmembers() if os.path.basename(m.name) in want])
items = []
for d, p in zip(labels, paths):
    if 'gtzan' in d: p = f"gz/genres/{d['gtzan'].split('.')[0]}/{d['gtzan']}"
    if p and os.path.exists(p): items.append({'id': d['stem'], 'path': p})
print('songs', len(items), f'{time.time()-t0:.0f}s', flush=True)
dl.wait(); print('fsl zip', os.path.getsize('fsl.zip'), f'{time.time()-t0:.0f}s', flush=True)
urllib.request.urlretrieve('https://zenodo.org/api/records/3967852/files/annotations.zip/content', 'ann.zip')
annotated = {n.split('sound-')[1].split('.')[0] for n in zipfile.ZipFile('ann.zip').namelist() if 'sound-' in n}
z = zipfile.ZipFile('fsl.zip'); meta = json.loads(z.read('metadata.json'))
loops = []
for sid, d in meta.items():
    try: b = float((d.get('annotations') or {}).get('bpm'))
    except Exception: continue
    if sid not in annotated and 40 <= b <= 250: loops.append({'id': sid, 'bpm': b, 'group': 'fsl:' + d['username']})
judge_up = {meta[s]['username'] for s in json.load(open(f'{HERE}/fsl-judge-ids.json'))['ids'] if s in meta}
loops = [r for r in loops if r['group'][4:] not in judge_up]   # near-identical loops by the same uploader would leak
print('annotated excluded', len(annotated), 'judge uploaders excluded', len(judge_up), 'candidate loops', len(loops), flush=True)
per = collections.Counter(); keep = []
for r in sorted(loops, key=lambda r: hashlib.sha256(r['id'].encode()).hexdigest()):
    if per[r['group']] < CAP: per[r['group']] += 1; keep.append(r)
os.makedirs('loops', exist_ok=True); os.makedirs('judge', exist_ok=True)
train_ids = {r['id'] for r in keep}; judge = []
for n in z.namelist():
    if not (n.startswith('audio/') and n.endswith('.wav')): continue
    sid = n.split('/')[-1].split('_')[0]
    if sid in train_ids: open(f'loops/{sid}.wav', 'wb').write(z.read(n)); items.append({'id': f'fsl_{sid}', 'path': f'loops/{sid}.wav'})
assert not (train_ids & annotated)
print('loops kept', len(keep), 'uploaders', len(per), f'{time.time()-t0:.0f}s', flush=True)
json.dump(items, open('items.json', 'w'))
subprocess.run([sys.executable, 'feats.py', 'items.json', 'feats'], check=True, env={**os.environ, 'J': os.environ.get('J', '8'), 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1'})  # HF jobs report the 64-core host, not the flavor's CPUs
rows = [{'f': f"{W}/feats/{d['stem']}.npz", 'bpm': d['bpm'], 'group': d['group'], 'src': d['src']} for d in labels if os.path.exists(f"feats/{d['stem']}.npz")]
rows += [{'f': f"{W}/feats/fsl_{r['id']}.npz", 'bpm': r['bpm'], 'group': r['group'], 'src': 'fsl', 'loop': True} for r in keep if os.path.exists(f"feats/fsl_{r['id']}.npz")]
json.dump({'tempo': rows}, open('labels.json', 'w')); print('features', len(rows), collections.Counter(r['src'] for r in rows), f'{time.time()-t0:.0f}s', flush=True)
json.dump([r['id'] for r in keep], open('out/train-loop-ids.json', 'w'))
if STAGE == 'prep':
    subprocess.run(['tar', 'cf', 'out/feats.tar', 'labels.json', 'feats'], check=True)
    api.upload_folder(folder_path='out', path_in_repo=f'runs/{RUN}/prep', repo_id=REPO, repo_type='dataset'); print('prep uploaded', f'{time.time()-t0:.0f}s', flush=True); sys.exit(0)
env = {**os.environ, 'WORKERS': str(max(2, os.cpu_count() - 1))}
for mode in os.environ.get('MODES', 'final').split():
    r = subprocess.run([sys.executable, 'train_tempo.py', mode, 'labels.json', 'out'], env=env, capture_output=True, text=True)
    print(r.stdout[-4000:], r.stderr[-4000:], flush=True); open(f'out/{mode}.log', 'w').write(r.stdout + r.stderr)
    if r.returncode: sys.exit(f'{mode} failed with exit code {r.returncode}; nothing uploaded')
    print(mode, 'done', f'{time.time()-t0:.0f}s', flush=True)
    api.upload_folder(folder_path='out', path_in_repo=f'runs/{RUN}', repo_id=REPO, repo_type='dataset')
print('uploaded', flush=True)
