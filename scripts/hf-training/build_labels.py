"""Tempo tuning labels from public sources only. Excludes every held-out set: round 1's 500 GiantSteps tempo clips,
round 2's 500 GiantSteps MTG key tracks, round 3's reserved half, GTZAN's held-out half (tempo thread split).
Usage: build_labels.py <out.json>"""
import csv, gzip, hashlib, json, os, subprocess, sys, urllib.request
RAW = 'https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer'
get = lambda u: urllib.request.urlopen(u, timeout=60).read()
for name, url in (('mtg', 'https://github.com/GiantSteps/giantsteps-mtg-key-dataset.git'), ('tempo', 'https://github.com/GiantSteps/giantsteps-tempo-dataset.git')):
    if not os.path.exists(f'gs-{name}'): subprocess.run(['git', 'clone', '-q', '--depth', '1', url, f'gs-{name}'], check=True)
r2 = set(json.loads(get(f'{RAW}/claude/fix-key-detection-cqon56/scripts/key/heldout-mtg-key.json'))['sampleKeys'])
r1 = {i['sampleKey'] for i in json.loads(get(f'{RAW}/main/docs/evaluations/dj-clips-2026-10-06/giantsteps-manifest.json'))['items']}
tune = json.loads(gzip.decompress(get(f'{RAW}/main/docs/evaluations/tempo-2026-10-06/features/tune.json.gz')))
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
md5 = lambda d, n: open(f'{d}/md5/{n}.md5').read().split()[0]
meta = {r['ID'].strip(): r for r in csv.DictReader(open('gs-mtg/annotations/beatport_metadata.txt'), delimiter='\t')}
out = []
for n in sorted(f[:-4] for f in os.listdir('gs-mtg/md5')):
    if n in r2 or int(h('dge-holdout-r3-2026-10-06', n)[:8], 16) % 2 == 0: continue
    m = meta.get(n.split('.')[0], {})
    try: b = float(m.get('BP BPM') or 0)
    except ValueError: b = 0
    if b <= 0: continue
    g = (m.get('BP GENRE') or '').strip().lower()
    if 'drum' in g and b < 110: b *= 2          # Beatport lists most D&B at half time
    out.append({'stem': f'mtg_{n}', 'bpm': b, 'group': 'mtg:' + (m.get('ARTIST', '').strip() or n), 'src': 'mtg', 'md5': md5('gs-mtg', n),
                'urls': [f'https://www.cp.jku.at/datasets/giantsteps/mtg_key_backup/{n}.mp3', f'https://geo-samples.beatport.com/lofi/{n}.mp3']})
gs_tune = {r['key']: r['truth'] for r in tune if r['source'] == 'giantsteps'}
for n, b in sorted(gs_tune.items()):
    assert n not in r1
    out.append({'stem': f'gst_{n}', 'bpm': b, 'group': f'gst:{n}', 'src': 'gst', 'md5': md5('gs-tempo', n),
                'urls': [f'https://www.cp.jku.at/datasets/giantsteps/backup/{n}.mp3', f'https://geo-samples.beatport.com/lofi/{n}.mp3']})
seen = set()
for r in tune:
    if r['source'] == 'gtzan' and r['key'] not in seen and r['truth']:
        seen.add(r['key']); out.append({'stem': f"gtzan_{r['key']}", 'bpm': r['truth'], 'group': 'gtzan:' + r['key'], 'src': 'gtzan', 'gtzan': r['key']})
json.dump(out, open(sys.argv[1], 'w')); print('labels', len(out), {s: sum(d['src'] == s for d in out) for s in ('mtg', 'gst', 'gtzan')})
