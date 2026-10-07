"""Audio for scoring the tagger on the round 3 held-out MTG-Jamendo set (PR #121): judging only, never training.

Usage: python3 scripts/audio-model/prepare-holdout.py <jamendo-manifest.json> <raw_30s_audio-low_sha256_tracks.txt> <out-dir>/<name>

Streams the dataset's raw_30s/audio-low archive folders that hold the manifest's tracks, checks each MP3 against the
published SHA-256, and cuts the manifest's excerpt (the middle 30 s) as 32 kHz mono int16. Writes <name>.npy
[N, 960000] and <name>.json with present/absent labels per class; untagged classes are listed under `weak`, as the
manifest's weak reviews are. Per-track results are not written anywhere; evaluate.py reports aggregates only.
"""
import hashlib, json, os, subprocess, sys, tarfile, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np

URL = 'https://cdn.freesound.org/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'
manifest, sums, base = sys.argv[1:4]
os.makedirs(os.path.dirname(base) or '.', exist_ok=True)
sha = dict(reversed(line.split()) for line in open(sums))
items = json.load(open(manifest))['items']
L = 960000
wav = np.lib.format.open_memmap(base + '.npy', mode='w+', dtype=np.int16, shape=(len(items), L))
rows = {it['archivePath']: i for i, it in enumerate(items)}
done = set()

def folder(f):
    needed = {p for p in rows if int(p.split('/')[0]) == f}
    for attempt in range(5):
        try:
            with urllib.request.urlopen(URL.format(f), timeout=120) as res, tarfile.open(fileobj=res, mode='r|') as tar:
                for m in tar:
                    rel = '/'.join(m.name.split('/')[-2:])
                    if not m.isfile() or rel not in needed or rel in done: continue
                    data = tar.extractfile(m).read()
                    if hashlib.sha256(data).hexdigest() != sha[rel]: raise ValueError(f'checksum mismatch for {rel}')
                    it = items[rows[rel]]
                    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(it['start']), '-t', str(round(it['end'] - it['start'], 3)), '-i', 'pipe:0',
                                          '-ac', '1', '-ar', '32000', '-f', 's16le', 'pipe:1'], input=data, capture_output=True, check=True).stdout
                    x = np.frombuffer(pcm, np.int16)[:L]; wav[rows[rel]] = np.pad(x, (0, L - len(x))); done.add(rel)
                    if needed <= done: break
            return
        except Exception as e:
            print(f'folder {f:02d} attempt {attempt + 1}: {e}', flush=True); time.sleep(2 ** attempt * 5)

folders = sorted({int(p.split('/')[0]) for p in rows})
with ThreadPoolExecutor(4) as pool: list(pool.map(folder, folders))
if len(done) != len(items): sys.exit(f'{len(items) - len(done)} held-out tracks could not be fetched')
wav.flush()
out = []
for it in items:
    rv = [r for r in it['reviews'] if r['dimension'] == 'source']
    out.append({'id': it['id'], 'artist': it['groups']['artist'], 'djTier': it.get('djTier'),
                'labels': {r['label']: r['state'] for r in rv}, 'weak': [r['label'] for r in rv if r.get('weak')]})
json.dump({'source': manifest, 'items': out}, open(base + '.json', 'w'))
print(f'{len(items)} held-out tracks from {len(folders)} folders')
