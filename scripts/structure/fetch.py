"""Downloads Raveform tracks (EDM with hand-labelled intro/buildup/drop/breakdown/outro) for one shard.

usage: fetch.py SEGMENTS_JSON OUT_DIR SHARD/SHARDS [LIMIT]
Writes OUT_DIR/manifest.json: [{key, file}] for the tracks that downloaded. Audio is never committed."""
import json, os, subprocess, sys, time

segments, out, shard = sys.argv[1], sys.argv[2], sys.argv[3]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 10**9
index, count = map(int, shard.split('/'))
tracks = sorted(json.load(open(segments)), key=lambda t: t['key'])
mine = [t for i, t in enumerate(tracks) if i % count == index][:limit]
os.makedirs(out, exist_ok=True)
manifest, failures = [], 0
for t in mine:
    stem = os.path.join(out, t['key'])
    cmd = ['yt-dlp', '-q', '--no-warnings', '--no-playlist', '-f', 'bestaudio/best', '--js-runtimes', 'node', '--sleep-requests', '1', '-o', stem + '.%(ext)s',
           'https://www.youtube.com/watch?v=' + t['id']]
    try:
        subprocess.run(cmd, check=True, timeout=300, capture_output=True)
        files = [f for f in os.listdir(out) if f.startswith(t['key'] + '.') and not f.endswith('.part')]
        if files:
            manifest.append({'key': t['key'], 'file': os.path.join(out, files[0])})
            continue
    except Exception as error:  # unavailable, region-locked or rate-limited: skip, keep going
        msg = getattr(error, 'stderr', b'') or b''
        print(t['key'], 'failed:', msg.decode(errors='replace').strip().splitlines()[-1:] if msg else error, flush=True)
    failures += 1
    if failures >= 25 and not manifest:
        sys.exit('no downloads succeeded')
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'))
print(f'{len(manifest)} of {len(mine)} downloaded')
