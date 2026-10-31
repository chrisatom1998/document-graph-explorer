"""Fetch training clips from the freesound-laion-640k mirror by row-group range reads (audio + id columns only).
For each row group holding a positive, keeps the positives plus every pool clip in that group of kind drum-hit/synth
and up to BG background clips. Writes <out>/<id>.<ext> (original bytes) and <out>/fetched.jsonl.
Usage: fetch.py <cand.json> <out dir> [BG]"""
import json, os, sys, time, random, collections, requests
from concurrent.futures import ThreadPoolExecutor
import pyarrow.parquet as pq
CAND, OUT = sys.argv[1:3]; BG = int(sys.argv[3]) if len(sys.argv) > 3 else 12
os.makedirs(OUT, exist_ok=True); TMP = OUT + '/.sparse/'; os.makedirs(TMP, exist_ok=True)
URL = 'https://huggingface.co/datasets/benjamin-paine/freesound-laion-640k/resolve/main/'
d = json.load(open(CAND)); pos = d['clips']; pool = d['pool']
byfile = collections.defaultdict(list)
for c in pos: byfile[c['file']].append(dict(c, role='pos'))
poolby = collections.defaultdict(list)
for c in pool: poolby[c['file']].append(c)
S = requests.Session(); H = {'Authorization': 'Bearer ' + os.environ['HF_TOKEN']} if os.environ.get('HF_TOKEN') else {}
def get(f, a, b):
    for k in range(5):
        try:
            r = S.get(URL + f, headers={**H, 'Range': f'bytes={a}-{b}'}, timeout=(20, 180))
            if r.status_code == 206: return r.content
        except Exception: pass
        time.sleep(2 ** k)
    raise RuntimeError('range fail ' + f)
log = open(OUT + '/fetched.jsonl', 'a')
def job(f):
    t = time.time(); sp = TMP + f.replace('/', '_')
    try:
        size = int(S.head(URL + f, headers=H, allow_redirects=True, timeout=(20, 60)).headers['Content-Length'])
        tail = get(f, size - 65536, size - 1); flen = int.from_bytes(tail[-8:-4], 'little')
        foot = tail if flen + 8 <= len(tail) else get(f, size - flen - 8, size - 1)
        with open(sp, 'wb') as h: h.truncate(size); h.seek(size - len(foot)); h.write(foot)
        md = pq.ParquetFile(sp).metadata; starts = []; s = 0
        for i in range(md.num_row_groups): starts.append(s); s += md.row_group(i).num_rows
        grp = lambda row: max(i for i in range(len(starts)) if starts[i] <= row)
        n = 0
        for g in sorted({grp(c['row']) for c in byfile[f]}):
            lo, hi = starts[g], starts[g] + md.row_group(g).num_rows
            sel = [c for c in byfile[f] if lo <= c['row'] < hi]
            pl = [c for c in poolby[f] if lo <= c['row'] < hi]
            hard = [dict(c, role='neg') for c in pl if c['kind'] != 'background']
            bg = [dict(c, role='neg') for c in pl if c['kind'] == 'background']; random.Random(f + str(g)).shuffle(bg)
            sel += hard + bg[:BG]
            rg = md.row_group(g)
            for j in range(rg.num_columns):
                c = rg.column(j)
                if c.path_in_schema in ('audio.bytes', 'audio.path', 'freesound_id'):
                    a = c.dictionary_page_offset if c.has_dictionary_page and c.dictionary_page_offset else c.data_page_offset
                    data = get(f, a, a + c.total_compressed_size - 1)
                    with open(sp, 'r+b') as h: h.seek(a); h.write(data)
            tb = pq.ParquetFile(sp).read_row_group(g, columns=['audio', 'freesound_id'])
            ids = tb.column('freesound_id').to_pylist(); au = tb.column('audio')
            for c in sel:
                k = c['row'] - lo; assert ids[k] == c['freesoundId'], (f, g, k)
                x = au[k].as_py(); ext = os.path.splitext(x.get('path') or '')[1] or '.bin'
                open(f"{OUT}/{c['id']}{ext}", 'wb').write(x['bytes'])
                log.write(json.dumps({k2: c[k2] for k2 in ('id', 'freesoundId', 'username', 'group', 'title', 'role') if k2 in c} | {'kind': c.get('kind', 'real'), 'labels': c.get('labels', []), 'path': f"{c['id']}{ext}"}) + '\n'); n += 1
        log.flush(); os.remove(sp); print(f, n, round(time.time() - t), flush=True)
    except Exception as e:
        print('FAIL', f, repr(e), flush=True)
        if os.path.exists(sp): os.remove(sp)
with ThreadPoolExecutor(6) as ex: list(ex.map(job, sorted(byfile)))
