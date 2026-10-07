"""Fetch the audio for the frozen MTG-Jamendo held-out tracks in some of the dataset's 100 archive folders.

Usage: python3 scripts/holdout-r3/fetch-jamendo.py <manifest.json> <raw_30s_audio-low_sha256_tracks.txt> <shard i/n> <audio-out-dir>

Folder f (00-99, the last two digits of the track id) belongs to shard i when f % n == i. Each needed folder's
raw_30s/audio-low tar is streamed from the dataset's MTG mirror without being stored; only selected tracks are kept,
each checked against the dataset's published per-track SHA-256, then cut to the manifest's excerpt as 44.1 kHz WAV.
"""
import hashlib, json, os, subprocess, sys, tarfile, time, urllib.request

URL = 'https://cdn.freesound.org/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'
manifest, sums, shard, out = sys.argv[1:5]
i, n = map(int, shard.split('/'))
os.makedirs(out, exist_ok=True)
want = {line.split()[1]: line.split()[0] for line in open(sums)}
items = {it['archivePath']: it for it in json.load(open(manifest))['items']}
folders = sorted({int(p.split('/')[0]) for p in items if int(p.split('/')[0]) % n == i})
done = 0
for f in folders:
    needed = {p: it for p, it in items.items() if int(p.split('/')[0]) == f}
    for attempt in range(5):
        got = {}
        try:
            with urllib.request.urlopen(URL.format(f), timeout=120) as res, tarfile.open(fileobj=res, mode='r|') as tar:
                for m in tar:
                    rel = '/'.join(m.name.split('/')[-2:])
                    if m.isfile() and rel in needed:
                        data = tar.extractfile(m).read()
                        if hashlib.sha256(data).hexdigest() != want[rel]: raise ValueError(f'checksum mismatch for {rel}')
                        got[rel] = data
                        if len(got) == len(needed): break          # stop streaming once every needed track is in hand
            if len(got) == len(needed): break
            raise ValueError(f'folder {f:02d}: {len(needed) - len(got)} tracks not in the archive')
        except Exception as e:
            print(f'folder {f:02d} attempt {attempt + 1}: {e}', flush=True); time.sleep(2 ** attempt * 5)
    else: sys.exit(f'folder {f:02d} could not be fetched')
    for rel, data in got.items():
        it = needed[rel]; tmp = os.path.join(out, it['id'] + '.mp3')
        open(tmp, 'wb').write(data)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(it['start']), '-t', str(round(it['end'] - it['start'], 3)), '-i', tmp,
                        '-ar', '44100', os.path.join(out, it['id'] + '.wav')], check=True)
        os.remove(tmp); done += 1
    print(f'folder {f:02d}: {len(got)} tracks', flush=True)
print(f'shard {shard}: {done} tracks from {len(folders)} folders')
