"""Downloads Raveform tracks (EDM with hand-labelled intro/buildup/drop/breakdown/outro) for one shard.

usage: fetch.py SEGMENTS_JSON OUT_DIR SHARD/SHARDS [LIMIT]
Tries the labelled YouTube upload first; when YouTube refuses, searches SoundCloud by title and takes only an upload
whose length is within 2 s of the labelled track, so the labelled times still line up.
Writes OUT_DIR/manifest.json: [{key, file, source}] for the tracks that downloaded. Audio is never committed."""
import json, os, re, subprocess, sys

segments, out, shard = sys.argv[1], sys.argv[2], sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 10**9
index, count = map(int, shard.split('/'))
tracks = sorted(json.load(open(segments)), key=lambda t: t['key'])
mine = [t for i, t in enumerate(tracks) if i % count == index][:limit]
os.makedirs(out, exist_ok=True)
BASE = ['yt-dlp', '-q', '--no-warnings', '--no-playlist', '--js-runtimes', 'node']


def run(cmd, timeout=300):
    return subprocess.run(cmd, check=True, timeout=timeout, capture_output=True, text=True).stdout


def download(key, url):
    stem = os.path.join(out, key)
    run(BASE + ['-f', 'bestaudio/best', '-o', stem + '.%(ext)s', url])
    files = [f for f in os.listdir(out) if f.startswith(key + '.') and not f.endswith('.part')]
    return os.path.join(out, files[0]) if files else None


def soundcloud(t):
    query = re.sub(r'\[[^\]]*\]', '', t['title']).strip()
    found = run(BASE + ['--sleep-requests', '2', '--flat-playlist', '-J', f'scsearch5:{query}'], 120)
    for entry in json.loads(found).get('entries') or []:
        if entry.get('duration') and abs(entry['duration'] - t['duration']) <= 2 and entry.get('url'):
            return entry['url']
    return None


manifest, youtube_failures = [], 0
for t in mine:
    for source in ('youtube', 'soundcloud'):
        if source == 'youtube' and youtube_failures >= 10 and youtube_failures > 3 * sum(m['source'] == 'youtube' for m in manifest):
            continue  # YouTube is refusing this runner; stop spending time on it
        try:
            url = 'https://www.youtube.com/watch?v=' + t['id'] if source == 'youtube' else soundcloud(t)
            file = url and download(t['key'], url)
            if file:
                manifest.append({'key': t['key'], 'file': file, 'source': source})
                break
        except Exception as error:
            msg = (getattr(error, 'stderr', '') or str(error)).strip().splitlines()
            print(t['key'], source, 'failed:', msg[-1][:200] if msg else error, flush=True)
        if source == 'youtube':
            youtube_failures += 1
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'))
by = {s: sum(m['source'] == s for m in manifest) for s in ('youtube', 'soundcloud')}
print(f'{len(manifest)} of {len(mine)} downloaded', by)
