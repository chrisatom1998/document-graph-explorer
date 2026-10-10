"""Round 10 commercial training packs (SampleRadar, Philharmonia, BBC, Sonniss; owner-approved, private) as tagger windows.

Usage: python3 scripts/audio-model/prepare-round10.py <bucket> <prefix> <out-dir> [--list <path in bucket>] [--limit N]
  The bucket holds <prefix>/<path> audio (first 30 s, mono 16 kHz WAV) and the train list (default <prefix>/round10/train-list.csv:
  path, source, group, present_tags, absent_tags, ... ; tags joined by ';'). The list is train-only: test filtering ran beforehand
  in the project container and nothing about the test sets is in the bucket.
  -> round10-mel.npy + round10.json   first 10 s of each clip as 1000 log-mel frames

Tags come from pack, folder and file names (weak by nature). A clip's own tags are present, its listed absent_tags are outright
absences, and every other round 10 tag is a weak absence. One pack in eight (by hash) is validation. No held-out split: these
packs are scored through the existing test and judge sets only.
"""
import argparse, csv, hashlib, importlib.util, os, shutil, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from labelmap import CAT  # noqa: E402
from labels_extra import EXTRA_CAT  # noqa: E402
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
split = lambda s: [t for t in (s or '').split(';') if t]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('bucket'); ap.add_argument('prefix'); ap.add_argument('out')
    ap.add_argument('--list', default=''); ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    from huggingface_hub import download_bucket_files
    prefix = args.prefix.strip('/'); tmp = tempfile.mkdtemp(dir=args.out)
    lst = os.path.join(tmp, 'train-list.csv')
    download_bucket_files(args.bucket, [(args.list or f'{prefix}/round10/train-list.csv', lst)], raise_on_missing_files=True)
    rows = [r for r in csv.DictReader(open(lst)) if r.get('split', 'train') == 'train']
    if args.limit: rows = rows[::max(1, len(rows) // args.limit)]
    known = set(CAT) | set(EXTRA_CAT)
    T = sorted({t for r in rows for t in split(r['present_tags'])} & known)
    missing = sorted({t for r in rows for t in split(r['present_tags'])} - known)
    if missing: print(f'round10: no output for {missing}; those labels are dropped', flush=True)
    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(HERE, 'prepare-extra.py'))
    pe = importlib.util.module_from_spec(spec); spec.loader.exec_module(pe)
    w = pe.Writer(args.out, 'round10', 1000); skipped = 0
    def load(r):
        p = os.path.join(tmp, 'a', r['path'])
        try: return pe.decode(open(p, 'rb').read())
        except OSError: return None
        finally:
            if os.path.exists(p): os.remove(p)
    for k in range(0, len(rows), 1000):   # a chunk at a time, so the 37 GB of audio never sits on disk at once
        chunk = rows[k:k + 1000]
        download_bucket_files(args.bucket, [(f"{prefix}/{r['path']}", os.path.join(tmp, 'a', r['path'])) for r in chunk])
        with ThreadPoolExecutor(8) as pool: xs = list(pool.map(load, chunk))
        for r, x in zip(chunk, xs):
            own = set(split(r['present_tags'])) & set(T)
            if x is None or not own: skipped += 1; continue
            absent = set(split(r['absent_tags'])) & known - own
            labels = {f'cat:{l}': float(l in own) for l in T}
            labels.update({f'cat:{l}': 0.0 for l in absent})
            w.add({'id': f"round10:{r['source']}:{r['path']}", 'artist': f"pack:{r['source']}:{r['group']}",
                   'val': int(h('dge-round10-val', r['source'], r['group'])[:8], 16) % 8 == 0,
                   'labels': labels, 'weakAbsent': [f'cat:{l}' for l in T if l not in own and l not in absent], 'source': r['source']}, x)
        print(f'round10: {min(k + 1000, len(rows))} of {len(rows)} clips read', flush=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'round10: {skipped} clips skipped (silent, unreadable or no tagger output)', flush=True)
    w.close('owner-approved commercial packs (SampleRadar, Philharmonia, BBC RemArc, Sonniss GDC): private training only, never redistributed')

if __name__ == '__main__':
    main()
