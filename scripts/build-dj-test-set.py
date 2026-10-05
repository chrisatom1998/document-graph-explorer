"""Builds a ~300-clip set for human review from audio already on this machine, converted to
small MP3s. Sources: Freesound clips by tag, the user's own sample pack, expert-annotated
loops, and labelled drum one-shots. File names and source tags are hidden from the reviewer;
they are kept only as `hint` so chosen clips can be excluded from training and compared later.
Usage: build-dj-test-set.py <out dir>"""
import json, sys, os, random, subprocess, hashlib, glob, io
OUT = sys.argv[1]; SECONDS = 15; M = '/Users/chrisjohnson/Documents/Media'
random.seed(20261004); chosen = []
def add(path, source, hint, data=None): chosen.append({'path': path, 'source': source, 'hint': hint, 'data': data})

for folder in sorted(glob.glob(f'{M}/dj-training-sounds/*/')):                      # 20 tags x 9
    files = sorted(glob.glob(folder + '*.ogg'))
    for p in random.sample(files, min(9, len(files))): add(p, 'freesound', os.path.basename(folder.rstrip('/')).replace('-', ' '))
for p in sorted(glob.glob(f'{M}/Shadow UK Bass Vol 1 Samples/*/*.wav')):            # the user's own pack
    if os.path.basename(p).startswith(('._', '_')) or os.path.getsize(p) < 50_000: continue
    add(p, 'own pack', os.path.basename(os.path.dirname(p)).lower())
fsld = '/Users/chrisjohnson/Documents/Codex/2026-10-04/task-2/dj_roles_v4'           # expert-annotated loops
rows = json.load(open(f'{fsld}/EXTRACTION_INPUTS.json'))['rows']
for r in random.sample(rows, 60):
    p = f"{fsld}/audio/{r['id'].replace('fsld_', '')}.wav"
    if os.path.exists(p): add(p, 'fsld', '+'.join(k for k, v in r['truth'].items() if v == 1) or 'none')
try:                                                                                 # labelled drum one-shots
    import pyarrow.parquet as pq
    f = pq.ParquetFile(f'{M}/audio-datasets/hiphop-one-shots/data/train-00000-of-00001.parquet')
    names = json.loads(f.schema_arrow.metadata[b'huggingface'])['info']['features']['label']['names']
    t = f.read(); per = {n: [] for n in names}
    labels = t.column('label').to_pylist()
    for i, l in enumerate(labels): per[names[l]].append(i)
    for n, idx in per.items():
        for i in random.sample(idx, min(5 if n != '808S' else 8, len(idx))):
            add(f'hiphop-one-shots#{i}', 'one-shots', n.lower(), t.column('audio')[i].as_py()['bytes'])
except Exception as e: print('one-shots skipped:', e)

random.shuffle(chosen); os.makedirs(f'{OUT}/audio', exist_ok=True); out = []
for c in chosen:
    cid = hashlib.sha256(c['path'].encode()).hexdigest()[:12]; mp3 = f'{OUT}/audio/{cid}.mp3'
    if not os.path.exists(mp3):
        src = ['-i', 'pipe:0'] if c['data'] else ['-i', c['path']]
        r = subprocess.run(['ffmpeg', '-nostdin' if not c['data'] else '-hide_banner', '-v', 'error', '-y', *src, '-t', str(SECONDS), '-ac', '2', '-b:a', '160k', mp3], input=c['data'])
        if r.returncode or not os.path.exists(mp3) or os.path.getsize(mp3) < 800:
            if os.path.exists(mp3): os.remove(mp3)
            continue
    out.append({'id': cid, 'path': c['path'], 'source': c['source'], 'hint': c['hint']})
json.dump({'kind': 'dj-test-set-v1', 'seconds': SECONDS, 'clips': out}, open(f'{OUT}/clips.json', 'w'), indent=1)
import collections; print(f'{len(out)} clips ready:', dict(collections.Counter(c['source'] for c in out)))
