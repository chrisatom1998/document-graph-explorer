"""Fetch the audio for frozen MTG-Jamendo tracks with HTTP range requests instead of streaming whole archive folders.

Usage: python3 scripts/hf-eval/fetch-jamendo-ranges.py <manifest.json> <raw_30s_audio-low_sha256_tracks.txt> <shard i/n> <audio-out-dir>

Same arguments, shard rule (folder f belongs to shard i when f % n == i), SHA-256 checks and 44.1 kHz WAV excerpts as
scripts/holdout-r3/fetch-jamendo.py and scripts/all-tags/fetch-jamendo.py. Those stream each 1.8 GB folder tar until
every needed track has passed; on HF Jobs that runs at ~2.5 MB/s per stream (about 12 min a folder). The tars are
uncompressed and the mirror serves byte ranges, so this walks the 512-byte member headers and downloads only the
needed members, several folders at a time.
"""
import hashlib, http.client, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HOST, PATH = 'cdn.freesound.org', '/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'
manifest, sums, shard, out = sys.argv[1:5]
i, n = map(int, shard.split('/'))
os.makedirs(out, exist_ok=True)
want = {line.split()[1]: line.split()[0] for line in open(sums)}
items = {it['archivePath']: it for it in json.load(open(manifest))['items']}
folders = sorted({int(p.split('/')[0]) for p in items if int(p.split('/')[0]) % n == i})


class Ranges:
    """Byte ranges of one archive over a kept-alive HTTPS connection (reconnects once per failure)."""
    def __init__(self, path): self.path, self.conn = path, None
    def get(self, start, length):
        for attempt in range(6):
            try:
                if self.conn is None: self.conn = http.client.HTTPSConnection(HOST, timeout=60)
                self.conn.request('GET', self.path, headers={'Range': f'bytes={start}-{start + length - 1}'})
                res = self.conn.getresponse(); data = res.read()
                if res.status != 206 or len(data) != length: raise IOError(f'HTTP {res.status}, {len(data)} of {length} bytes')
                return data
            except Exception as e:
                if self.conn: self.conn.close()
                self.conn = None; print(f'{self.path} range {start} attempt {attempt + 1}: {e}', flush=True); time.sleep(2 ** attempt)
        raise IOError(f'{self.path}: range {start} failed')


def octal(b): return int(b.rstrip(b'\0 ').decode() or '0', 8)


def fetch_folder(f):
    needed = {p: it for p, it in items.items() if int(p.split('/')[0]) == f}
    r, pos, got, long_name = Ranges(PATH.format(f)), 0, {}, None
    while len(got) < len(needed):
        h = r.get(pos, 512)
        if h == b'\0' * 512: break
        size, kind = octal(h[124:136]), h[156:157]
        name = long_name or (h[345:500].rstrip(b'\0').decode() + '/' if h[257:262] == b'ustar' and h[345] else '') + h[:100].rstrip(b'\0').decode()
        long_name, body = None, pos + 512
        if kind == b'L': long_name = r.get(body, size).rstrip(b'\0').decode()
        elif kind == b'x':
            for rec in r.get(body, size).decode().split('\n'):
                if ' path=' in rec: long_name = rec.split(' path=', 1)[1]
        elif kind in (b'0', b'\0'):
            rel = '/'.join(name.split('/')[-2:])
            if rel in needed:
                data = r.get(body, size)
                if hashlib.sha256(data).hexdigest() != want[rel]: raise ValueError(f'checksum mismatch for {rel}')
                got[rel] = data
        pos = body + (size + 511) // 512 * 512
    if len(got) < len(needed): raise ValueError(f'folder {f:02d}: {len(needed) - len(got)} tracks not in the archive')
    for rel, data in got.items():
        it = needed[rel]; tmp = os.path.join(out, it['id'] + '.mp3')
        open(tmp, 'wb').write(data)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(it['start']), '-t', str(round(it['end'] - it['start'], 3)), '-i', tmp,
                        '-ar', '44100', os.path.join(out, it['id'] + '.wav')], check=True)
        os.remove(tmp)
    print(f'folder {f:02d}: {len(got)} tracks', flush=True)
    return len(got)


with ThreadPoolExecutor(int(os.environ.get('FETCH_THREADS', '4'))) as pool:
    done = sum(pool.map(fetch_folder, folders))
print(f'shard {shard}: {done} tracks from {len(folders)} folders')
