"""Fetch one shard of a genre/energy list and write 16 kHz mono WAVs (what the app's music model reads).

Usage: python3 scripts/genre-energy/fetch.py <list.json> <shard i/n> <audio-out-dir> <clips-out.json> [jamendo sha256 list]

Beatport items (GiantSteps backups): item k belongs to shard k % n; the whole preview is kept, MD5-checked.
MTG-Jamendo items: archive folder f (00-99) belongs to shard f % n; each folder's raw_30s/audio-low tar is streamed
without being stored, each kept track is checked against the published SHA-256 and cut to the item's excerpt.
Writes the shard's items that were fetched, each with its local path. Audio is never committed.
"""
import concurrent.futures, hashlib, json, os, subprocess, sys, tarfile, time, urllib.request

items, shard, out, clips_out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3], sys.argv[4]
i, n = map(int, shard.split('/'))
os.makedirs(out, exist_ok=True)
JAMENDO = 'https://cdn.freesound.org/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'

def cut(data, it, start=None, seconds=None):
    tmp = os.path.join(out, it['id'] + '.mp3'); wav = os.path.join(out, it['id'] + '.wav')
    open(tmp, 'wb').write(data)
    span = ['-ss', str(start), '-t', str(seconds)] if start is not None else []
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', *span, '-i', tmp, '-ac', '1', '-ar', '16000', wav], check=True)
    os.remove(tmp)
    return {**it, 'path': wav}

kept = []
if items and items[0]['dataset'] == 'mtg-jamendo':
    want = {line.split()[1]: line.split()[0] for line in open(sys.argv[5])}
    by_path = {it['archivePath']: it for it in items}
    for f in sorted({int(p.split('/')[0]) for p in by_path if int(p.split('/')[0]) % n == i}):
        needed = {p: it for p, it in by_path.items() if int(p.split('/')[0]) == f}
        got = {}
        for attempt in range(5):
            try:
                with urllib.request.urlopen(JAMENDO.format(f), timeout=120) as res, tarfile.open(fileobj=res, mode='r|') as tar:
                    for m in tar:
                        rel = '/'.join(m.name.split('/')[-2:])
                        if m.isfile() and rel in needed and rel not in got:
                            data = tar.extractfile(m).read()
                            if hashlib.sha256(data).hexdigest() == want.get(rel): got[rel] = data
                            if len(got) == len(needed): break
                break
            except Exception as e:
                print(f'folder {f:02d} attempt {attempt + 1}: {e}', flush=True); time.sleep(2 ** attempt * 5)
        for rel, data in got.items():
            it = needed[rel]; kept.append(cut(data, it, it['start'], round(it['end'] - it['start'], 3)))
        print(f'folder {f:02d}: {len(got)}/{len(needed)} tracks', flush=True)
else:
    def fetch(it):
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(it['url'], timeout=60).read()
                if hashlib.md5(data).hexdigest() == it['md5']: return cut(data, it)
            except Exception: pass
            time.sleep(2 ** attempt)
        return None
    mine = [it for k, it in enumerate(items) if k % n == i]
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        kept = [r for r in pool.map(fetch, mine) if r]
    print(f'{len(kept)}/{len(mine)} previews fetched')
json.dump(kept, open(clips_out, 'w'))
