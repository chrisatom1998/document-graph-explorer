"""Fetch Freesound clips from the HF mirror benjamin-paine/freesound-laion-640k by (parquet file, row), one row group at a
time, decode to 16 kHz mono 16-bit (first 30 s) and save as FLAC. Optionally also keeps up to --extra keyword-free
negative clips per row group from an eligible-id list (as test8's laion_get.py did), so negatives cost no extra reads.

Usage: python3 -I fetch_mirror.py <jobs.json> <out-dir> [--neg-eligible ids.json] [--extra 2]
  jobs.json: [{"id": 123, "file": "test-00000-of-00123.parquet", "row": 17}, ...]
  ids.json:  {"ids": [...], "user": {"id": "uploader"}}  (one negative per uploader overall)
Each parquet file is read in its own worker process. Writes <out-dir>/<id>.flac and <out-dir>/fetched.jsonl (id, file, row, role, encoded_sha256, seconds_kept).
"""
import argparse, hashlib, json, os, subprocess, sys, threading, time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem

ap = argparse.ArgumentParser()
ap.add_argument('jobs'); ap.add_argument('out'); ap.add_argument('--neg-eligible'); ap.add_argument('--extra', type=int, default=0)
ap.add_argument('--threads', type=int, default=6)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
jobs = json.load(open(a.jobs))
NE = json.load(open(a.neg_eligible)) if a.neg_eligible else {'ids': [], 'user': {}}
NEG = set(int(i) for i in NE['ids']); used_users = set(); lock = threading.Lock()
done = set()
log_path = f'{a.out}/fetched.jsonl'
if os.path.exists(log_path):
    for l in open(log_path):
        j = json.loads(l); done.add(int(j['id']))
        if j['role'] == 'negative' and str(j['id']) in NE['user']: used_users.add(NE['user'][str(j['id'])])   # resume: one negative per uploader
fs = HfFileSystem()
byfile = defaultdict(list)
for j in jobs:
    if int(j['id']) not in done: byfile[j['file']].append(j)


def decode(b):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-t', '30', '-ac', '1', '-ar', '16000', '-c:a', 'flac', '-f', 'flac', 'pipe:1'],
                       input=b, capture_output=True)
    return p.stdout if len(p.stdout) > 2000 else None


def save(i, f, row, role, b):
    flac = decode(b)
    if not flac: return
    open(f'{a.out}/{i}.flac', 'wb').write(flac)
    with open(log_path, 'a') as lg:   # one short append per clip, safe across worker processes
        lg.write(json.dumps({'id': i, 'file': f, 'row': row, 'role': role, 'encoded_sha256': hashlib.sha256(b).hexdigest()}) + '\n')


def one(item):
    f, js = item
    for t in range(4):
        try:
            pf = pq.ParquetFile(fs.open('datasets/benjamin-paine/freesound-laion-640k/data/' + f, block_size=8 << 20))
            starts, s = [], 0
            for g in range(pf.metadata.num_row_groups): starts.append(s); s += pf.metadata.row_group(g).num_rows
            groups = defaultdict(list)
            for j in js:
                g = max(k for k, st in enumerate(starts) if st <= j['row']); groups[g].append(j)
            for g, gj in groups.items():
                tb = pf.read_row_group(g, columns=['audio', 'freesound_id'])
                ids = [int(x) for x in tb.column('freesound_id').to_pylist()]
                for j in gj:
                    off = j['row'] - starts[g]
                    assert ids[off] == int(j['id']), (f, j, ids[off])
                    save(int(j['id']), f, j['row'], j.get('role', 'pick'), tb.slice(off, 1).to_pylist()[0]['audio']['bytes'])
                n = 0
                for k, x in enumerate(ids):
                    if n >= a.extra: break
                    if x in NEG and x not in done:
                        u = NE['user'][str(x)]
                        if u in used_users: continue   # per worker; build_test.py keeps one negative per uploader overall
                        used_users.add(u)
                        save(x, f, starts[g] + k, 'negative', tb.slice(k, 1).to_pylist()[0]['audio']['bytes']); n += 1
            print('ok', f, len(js), flush=True); return
        except Exception as e:
            err = e; time.sleep(5 * (t + 1))
    print('FAIL', f, err, flush=True)


t0 = time.time()
# One process per parquet file (pyarrow / fsspec buffers are only reliably freed when the process exits).
if __name__ == '__main__':
    with ProcessPoolExecutor(a.threads, max_tasks_per_child=1) as ex: list(ex.map(one, sorted(byfile.items())))
    print('done', time.time() - t0, flush=True)
