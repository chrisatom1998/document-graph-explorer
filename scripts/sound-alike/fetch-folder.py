"""Fetch one raw_30s/audio-low archive folder's selected tracks for embedding.

Usage: python3 scripts/sound-alike/fetch-folder.py <tracks.json> <folder 0-99> <out-dir> [max tracks]

Streams the folder's tar, keeps only tracks listed in tracks.json (SHA-256 checked; at most [max tracks], a fixed
hash-ordered sample so reruns pick the same ones) as <out-dir>/<track>.mp3 and
writes <out-dir>/manifest.json with one clip per 10 s window ({id: track@start, path, start}) for embed-clap.mjs.
"""
import hashlib, json, os, sys, tarfile, time, urllib.request

URL = 'https://cdn.freesound.org/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'
tracks_path, folder, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
cap = int(sys.argv[4]) if len(sys.argv) > 4 else None
os.makedirs(out, exist_ok=True)
pool = [t for t in json.load(open(tracks_path))['tracks'] if int(t['archivePath'].split('/')[0]) == folder]
pool.sort(key=lambda t: hashlib.sha256(f"dge-sound-alike|{t['track']}".encode()).hexdigest())
needed = {t['archivePath']: t for t in pool[:cap]}
got = {}
for attempt in range(6):
    try:
        with urllib.request.urlopen(URL.format(folder), timeout=120) as res, tarfile.open(fileobj=res, mode='r|') as tar:
            for m in tar:
                rel = '/'.join(m.name.split('/')[-2:])
                if not m.isfile() or rel not in needed or rel in got: continue
                data = tar.extractfile(m).read()
                if hashlib.sha256(data).hexdigest() != needed[rel]['sha256']: raise ValueError(f'checksum mismatch for {rel}')
                path = os.path.join(out, needed[rel]['track'] + '.mp3')
                open(path, 'wb').write(data); got[rel] = path
                if len(got) == len(needed): break
        break
    except Exception as e:
        print(f'folder {folder:02d} attempt {attempt + 1}: {e}', flush=True); time.sleep(2 ** attempt * 5)
clips = [{'id': f"{needed[rel]['track']}@{s}", 'path': os.path.abspath(path), 'start': s} for rel, path in sorted(got.items()) for s in needed[rel]['starts']]
json.dump({'clips': clips}, open(os.path.join(out, 'manifest.json'), 'w'))
print(f'folder {folder:02d}: {len(got)}/{len(needed)} tracks, {len(clips)} windows')
