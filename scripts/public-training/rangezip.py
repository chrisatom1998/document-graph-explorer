"""Fetch individual members of a (possibly split) Zenodo zip archive with HTTP Range requests.

Usage: python rangezip.py <record> <base e.g. FSD50K.dev_audio> <nparts> <wanted.txt: member basenames> <outdir>
Parts are <base>.z01..z<nparts-1> then <base>.zip (holds the central directory)."""
import os, struct, sys, zlib, time, requests
from concurrent.futures import ThreadPoolExecutor

REC, BASE, NPARTS, WANTED, OUT = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
os.makedirs(OUT, exist_ok=True)
S = requests.Session(); S.headers['User-Agent'] = 'document-graph-explorer-dataset-fetch/1.0 (research)'
parts = [f'{BASE}.z{i:02d}' for i in range(1, NPARTS)] + [f'{BASE}.zip']
url = lambda p: f'https://zenodo.org/records/{REC}/files/{p}?download=1'

def get(part, a, b):
    for t in range(8):
        try:
            r = S.get(url(part), headers={'Range': f'bytes={a}-{b}'}, timeout=120)
            if r.status_code == 206 and len(r.content) == b - a + 1: return r.content
        except Exception: pass
        time.sleep(min(60, 2 ** t))
    raise RuntimeError(f'range failed {part} {a}-{b}')

sizes = {}
for p in parts:
    r = S.head(url(p), allow_redirects=True, timeout=60); sizes[p] = int(r.headers['Content-Length'])
last = parts[-1]; tail = get(last, sizes[last] - 65536 - 22, sizes[last] - 1)
i = tail.rfind(b'PK\x05\x06'); eocd = tail[i:]
_, _, disk_cd, _, n_total, cd_size, cd_off = struct.unpack('<IHHHHII', eocd[:20])
# zip64?
j = tail.rfind(b'PK\x06\x07')
if j >= 0 and (cd_off == 0xFFFFFFFF or n_total == 0xFFFF):
    _, disk64, off64, _ = struct.unpack('<IIQI', tail[j:j + 20])
    z64 = get(parts[disk64], off64, off64 + 55)
    n_total, cd_size, cd_off = struct.unpack('<Q', z64[32:40])[0], *struct.unpack('<QQ', z64[40:56])
    disk_cd = struct.unpack('<I', z64[20:24])[0]
cd = b''
off, d = cd_off, disk_cd
while len(cd) < cd_size:
    take = min(cd_size - len(cd), sizes[parts[d]] - off)
    cd += get(parts[d], off, off + take - 1); d += 1; off = 0
members = {}
p = 0
while p < len(cd) and cd[p:p + 4] == b'PK\x01\x02':
    meth, = struct.unpack('<H', cd[p + 10:p + 12]); csize, usize = struct.unpack('<II', cd[p + 20:p + 28])
    nl, el, cl = struct.unpack('<HHH', cd[p + 28:p + 34]); disk, = struct.unpack('<H', cd[p + 34:p + 36]); lho, = struct.unpack('<I', cd[p + 42:p + 46])
    name = cd[p + 46:p + 46 + nl].decode(); extra = cd[p + 46 + nl:p + 46 + nl + el]
    q = 0
    while q < len(extra):
        hid, hl = struct.unpack('<HH', extra[q:q + 4])
        if hid == 1:
            vals = extra[q + 4:q + 4 + hl]; k = 0
            if usize == 0xFFFFFFFF: usize, = struct.unpack('<Q', vals[k:k + 8]); k += 8
            if csize == 0xFFFFFFFF: csize, = struct.unpack('<Q', vals[k:k + 8]); k += 8
            if lho == 0xFFFFFFFF: lho, = struct.unpack('<Q', vals[k:k + 8]); k += 8
        q += 4 + hl
    members[os.path.basename(name)] = (disk, lho, csize, usize, meth)
    p += 46 + nl + el + cl
print(f'{len(members)} members in central directory', file=sys.stderr)
if WANTED == '-':
    import json; json.dump({k: v[3] for k, v in members.items()}, sys.stdout); sys.exit()
wanted = [l.strip() for l in open(WANTED) if l.strip()]

FAILED = []

def fetch(name):
    try: return fetch1(name)
    except Exception as e: print('FAIL', name, e, file=sys.stderr); FAILED.append(name); return 0

def fetch1(name):
    dest = f'{OUT}/{name}'
    if os.path.exists(dest): return 0
    disk, lho, csize, usize, meth = members[name]
    def span(disk, off, n):
        out = b''
        while n > 0:
            take = min(n, sizes[parts[disk]] - off)
            out += get(parts[disk], off, off + take - 1); n -= take; disk += 1; off = 0
        return out, disk, off
    head, _, _ = span(disk, lho, 30)
    nl, el = struct.unpack('<HH', head[26:30])
    # advance to data start, possibly across a part boundary
    d, o = disk, lho + 30 + nl + el
    while o >= sizes[parts[d]]: o -= sizes[parts[d]]; d += 1
    data, _, _ = span(d, o, csize)
    if meth == 8: data = zlib.decompress(data, -15)
    assert len(data) == usize, name
    open(dest + '.part', 'wb').write(data); os.rename(dest + '.part', dest)
    return 1

with ThreadPoolExecutor(int(os.environ.get('THREADS', 8))) as ex:
    n = 0
    for k in ex.map(fetch, wanted):
        n += 1
        if n % 500 == 0: print(n, file=sys.stderr)
print('done', n, file=sys.stderr)
if FAILED: sys.exit(f'{len(FAILED)} members failed to download; re-run to resume (finished files are skipped)')
