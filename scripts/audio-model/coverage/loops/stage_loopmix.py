"""Stage loop-mix renders (render_loops.py output) as a datasets-v1 set for a tagger round, the layout of
datasets-v1/dsp-arp-v2, so r13-set.py prepares it unchanged.

  python3 stage_loopmix.py <render-dir> <out-dir> <set-name>

Writes <out-dir>/datasets-v1/<set-name>/{manifest.csv, audio-000.tar, absent.json, summary.json} and <out-dir>/keep.csv
(part, id, keep, tags) for the round's <prefix>-keep.csv. Every row is split=train with a group that prepare-run9.py
never puts in validation (the same rule as render_arp.py), so the tagger's cutoffs are still fit on real clips only.
"""
import csv, hashlib, io, json, os, sys, tarfile
import soundfile as sf

src, out, name = sys.argv[1:4]
d = os.path.join(out, 'datasets-v1', name); os.makedirs(d, exist_ok=True)
COLS = ['id', 'url', 'creator', 'licence', 'licence_class', 'encoded_sha256', 'pcm_sha256', 'seconds', 'split', 'group', 'tags',
        'label_evidence', 'route', 'score', 'source', 'part', 'file', 'keep', 'drop_reason', 'freesound_id', 'uploader', 'needs']


def train_group(base):   # never a prepare-run9.py validation group
    k = 0
    while int(hashlib.sha256(f'dge-run9-val|{base}:t{k}'.encode()).hexdigest()[:8], 16) % 5 == 0: k += 1
    return f'{base}:t{k}'


rows, keep = [], []
with tarfile.open(os.path.join(d, 'audio-000.tar'), 'w') as tar:
    for r in csv.DictReader(open(os.path.join(src, 'manifest.csv'))):
        p = os.path.join(src, r['file']); raw = open(p, 'rb').read()
        x, sr = sf.read(p, dtype='int16')
        fn = r['id'].replace(':', '_') + '.flac'
        ti = tarfile.TarInfo(fn); ti.size = len(raw); tar.addfile(ti, io.BytesIO(raw))
        tags = r['tags'].replace(';', '|')
        rows.append({'id': r['id'], 'creator': 'DGE loop-mix renderer (training one-shots on a step grid)',
                     'licence': 'derived from private training one-shots (SampleRadar, Philharmonia, FSD50K dev); private training only',
                     'licence_class': 'private', 'encoded_sha256': hashlib.sha256(raw).hexdigest(), 'pcm_sha256': hashlib.sha256(x.tobytes()).hexdigest(),
                     'seconds': r['seconds'], 'split': 'train', 'group': train_group(f'{name}:{r["style"]}:{int(r["id"].split(":")[1]) % 50}'),
                     'tags': tags, 'label_evidence': f'loop-mix render, {r["style"]} {r["bpm"]} bpm, bed {r["bed"] or "none"}, fx {r["fx"] or "none"}; tags by construction; not listened',
                     'route': 'generated', 'source': name, 'part': name, 'file': f'audio-000.tar/{fn}', 'keep': '1'})
        keep.append([name, r['id'], 1, tags])
with open(os.path.join(d, 'manifest.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
with open(os.path.join(out, 'keep.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['part', 'id', 'keep', 'tags']); w.writerows(keep)
absent = json.load(open(os.path.join(src, 'absent.json')))
json.dump(absent, open(os.path.join(d, 'absent.json'), 'w'))
json.dump({'rows': len(rows), 'with_absences': len(absent['absent'])}, open(os.path.join(d, 'summary.json'), 'w'))
print(len(rows), 'rows staged;', len(absent['absent']), 'with sure absences')
