"""HF Jobs driver: fetch tuning audio (never held-out), compute features, cross-validate and train the DGE tempo CNN,
upload results to the private dataset repo cmjatom/dge-key-tempo-train under runs/<RUN>/."""
import hashlib, json, os, subprocess, sys, tarfile, urllib.request, concurrent.futures, time
from huggingface_hub import HfApi, hf_hub_download
REPO = 'cmjatom/dge-key-tempo-train'; RUN = os.environ.get('RUN', 'tempo-v1'); api = HfApi()
W = '/work'; os.makedirs(f'{W}/audio', exist_ok=True); os.chdir(W)
for f in ('feats.py', 'train_tempo.py', 'build_labels.py'):
    os.system(f'cp {hf_hub_download(REPO, f, repo_type="dataset")} {W}/{f}')
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
t0 = time.time()
with concurrent.futures.ThreadPoolExecutor(16) as ex: paths = list(ex.map(lambda d: get(d) if 'urls' in d else None, labels))
urllib.request.urlretrieve('https://huggingface.co/datasets/marsyas/gtzan/resolve/main/data/genres.tar.gz', 'gtzan.tgz')
with tarfile.open('gtzan.tgz') as t:
    want = {d['gtzan'] for d in labels if 'gtzan' in d}
    t.extractall('gz', members=[m for m in t.getmembers() if os.path.basename(m.name) in want])
items = []
for d, p in zip(labels, paths):
    if 'gtzan' in d: p = f"gz/genres/{d['gtzan'].split('.')[0]}/{d['gtzan']}"
    if p and os.path.exists(p): items.append({'id': d['stem'], 'path': p})
json.dump(items, open('items.json', 'w')); print('audio', len(items), 'of', len(labels), f'{time.time()-t0:.0f}s', flush=True)
subprocess.run([sys.executable, 'feats.py', 'items.json', 'feats'], check=True, env={**os.environ, 'J': str(os.cpu_count())})
rows = [{'f': f"{W}/feats/{d['stem']}.npz", 'bpm': d['bpm'], 'group': d['group'], 'src': d['src']} for d in labels if os.path.exists(f"feats/{d['stem']}.npz")]
json.dump({'tempo': rows}, open('labels.json', 'w')); print('features', len(rows), f'{time.time()-t0:.0f}s', flush=True)
env = {**os.environ, 'WORKERS': str(max(2, os.cpu_count() - 1))}
for mode in os.environ.get('MODES', 'cv final').split():
    r = subprocess.run([sys.executable, 'train_tempo.py', mode, 'labels.json', 'out'], env=env, capture_output=True, text=True)
    print(r.stdout[-4000:], r.stderr[-4000:], flush=True); open(f'out/{mode}.log', 'w').write(r.stdout + r.stderr)
    if r.returncode: sys.exit(f'{mode} failed with exit code {r.returncode}; nothing uploaded')
    print(mode, 'done', f'{time.time()-t0:.0f}s', flush=True)
api.upload_folder(folder_path='out', path_in_repo=f'runs/{RUN}', repo_id=REPO, repo_type='dataset')
print('uploaded', flush=True)
