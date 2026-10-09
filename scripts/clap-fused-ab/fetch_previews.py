"""Fetches the first ~15 s of each DJ-effect clip's public Freesound preview (URL recorded in clips.json).
Usage: fetch_previews.py <clips.json> <out dir> <out clips.json> [shard shards]"""
import concurrent.futures, json, os, sys, time, urllib.request
CLIPS, DIR, OUT = sys.argv[1:4]; SHARD, SHARDS = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (0, 1)
os.makedirs(DIR, exist_ok=True)
clips = [c for k, c in enumerate(json.load(open(CLIPS))['clips']) if k % SHARDS == SHARD and c.get('preview', '').startswith('https://cdn.freesound.org/')]
def one(c):
    path = os.path.join(DIR, f"{int(c['freesoundId'])}.mp3")
    if os.path.exists(path): return c['id'], path
    for n in range(5):
        try:
            req = urllib.request.Request(c['preview'], headers={'User-Agent': 'Mozilla/5.0 (DGE research; non-commercial evaluation)', 'Range': 'bytes=0-249999'})
            data = urllib.request.urlopen(req, timeout=60).read()
            open(path, 'wb').write(data); return c['id'], path
        except urllib.error.HTTPError as e:
            if e.code in (404, 410): return c['id'], None
            time.sleep(3 * (n + 1))
        except Exception: time.sleep(3 * (n + 1))
    return c['id'], None
with concurrent.futures.ThreadPoolExecutor(4) as ex: got = [(i, p) for i, p in ex.map(one, clips) if p]
json.dump({'clips': [{'id': i, 'path': os.path.abspath(p)} for i, p in got]}, open(OUT, 'w'))
print(f'{len(got)} of {len(clips)} previews fetched')
