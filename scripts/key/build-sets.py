"""Fetch one shard of the key tuning and held-out sets and list its clips.

Usage: python3 scripts/key/build-sets.py <giantsteps-mtg-key checkout> <giantsteps-key checkout> <gtzan_key checkout>
                                         <gtzan genres.tar.gz> <out-dir> <shard i/n>

tune-mtg : GiantSteps MTG key tracks NOT among the 500 the round 2 DJ clip test uses (scripts/key/heldout-mtg-key.json)
           and not in the half reserved for round 3 (sha256("dge-holdout-r3-2026-10-06|<name>") even),
           with a single manual key at the annotators' top confidence (2); the whole preview as consecutive 10 s blocks.
tune-mtg-c1 : the same, for tracks whose single key has annotator confidence 1 (noisier labels).
tune-gtzan / test-gtzan : GTZAN clips with one Lerch key annotation (not -1), split in half by a seeded hash; the whole
           30 s clip, as the app analyses a recording under 60 s. Blues, classical, country, jazz, metal, pop, reggae,
           rock, disco and hip-hop, so a profile tuned for EDM cannot silently break other music.
mtg-500  : the round 2 test's 500 tracks with a single confidence-2 key, middle 10 s exactly as that test cuts them.
           Used only to judge before/after, never to tune.
gs-key   : the original GiantSteps key dataset (604 Beatport tracks, no track shared with the MTG key set), middle 10 s,
           the whole two-minute preview (the app's three 20 s excerpts) and the preview as 10 s blocks. Judging only.
Rows hold the path of the source audio plus start/seconds; scripts/key/features.mjs cuts and decodes them.
Audio is never committed.
"""
import concurrent.futures, csv, hashlib, json, os, subprocess, sys, tarfile, time, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
mk, gk, gzk, gtzan_tgz, out, shard = sys.argv[1:7]
si, sn = map(int, shard.split('/'))
os.makedirs(f'{out}/audio', exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
mine = lambda name: int(h('key-shard', name)[:8], 16) % sn == si
TONICS = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
GTZAN_ORDER = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']   # KeyEnumeration.txt: 0-11 major, 12-23 minor
held = set(json.load(open(os.path.join(ROOT, 'scripts/key/heldout-mtg-key.json')))['sampleKeys'])
dur = lambda p: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
                                     capture_output=True, text=True).stdout)

def key_of(text):
    parts = text.strip().split()
    if len(parts) != 2 or parts[0] not in TONICS or parts[1] not in ('major', 'minor'): return None
    return {'tonic': TONICS[parts[0]], 'mode': parts[1]}

def fetch(base, md5_dir, n):
    """The JKU backup first, then Beatport's own preview URL (the datasets' audio_dl.sh fallback); MD5-checked."""
    path = f'{out}/audio/{n}.mp3'
    want = open(os.path.join(md5_dir, n + '.md5')).read().split()[0]
    for url in (base + n + '.mp3', f'https://geo-samples.beatport.com/lofi/{n}.mp3'):
        for attempt in range(3):
            try:
                data = urllib.request.urlopen(url, timeout=60).read()
                if hashlib.md5(data).hexdigest() == want:
                    open(path, 'wb').write(data); return path
                break   # served but different audio: retrying the same URL will not help
            except Exception: pass
            time.sleep(2 ** attempt)
    return None

rows, failed = [], []
# GiantSteps MTG key
manual = {r['ID'].strip(): r for r in csv.DictReader(open(f'{mk}/annotations/annotations.txt'), delimiter='\t')}
meta = {r['ID'].strip(): r for r in csv.DictReader(open(f'{mk}/annotations/beatport_metadata.txt'), delimiter='\t')}
slug = lambda g: g.strip().lower().replace(' & ', '-and-').replace(' ', '-')
names = [n for n in sorted(f[:-4] for f in os.listdir(f'{mk}/md5')) if mine(n)]
labelled = {}
for n in names:
    a = manual.get(n.split('.')[0], {})
    k = key_of(a.get('MANUAL KEY', ''))
    r3 = n not in held and int(h('dge-holdout-r3-2026-10-06', n)[:8], 16) % 2 == 0   # round 3's reserved half
    if k and a.get('C', '').strip() in ('1', '2') and not r3 and (n not in held or a['C'].strip() == '2'):
        labelled[n] = {**k, 'c': int(a['C'].strip())}
with concurrent.futures.ThreadPoolExecutor(8) as pool:
    paths = dict(zip(labelled, pool.map(lambda n: fetch('https://www.cp.jku.at/datasets/giantsteps/mtg_key_backup/', f'{mk}/md5', n), labelled)))
for n, p in paths.items():
    if not p: failed.append(f'mtg:{n}'); continue
    c = labelled[n].pop('c')
    d = dur(p); base = {'track': f'mtg:{n}', 'path': p, 'truth': labelled[n], 'duration': round(d, 2),
                        'genre': slug(meta.get(n.split('.')[0], {}).get('BP GENRE', ''))}
    if n in held:
        rows.append({**base, 'set': 'mtg-500', 'id': f'mtg-{n}-mid10', 'plan': 'excerpt', 'start': round(max(0.0, d / 2 - 5), 3), 'seconds': 10})
    else:
        rows.append({**base, 'set': 'tune-mtg' if c == 2 else 'tune-mtg-c1', 'id': f'mtg-{n}-blocks', 'plan': 'blocks', 'start': 0, 'seconds': d})

# Original GiantSteps key dataset
names = [n for n in sorted(f[:-4] for f in os.listdir(f'{gk}/md5')) if mine(n)]
labelled = {n: key_of(open(f'{gk}/annotations/key/{n}.key').read()) for n in names if os.path.exists(f'{gk}/annotations/key/{n}.key')}
labelled = {n: k for n, k in labelled.items() if k}
with concurrent.futures.ThreadPoolExecutor(8) as pool:
    paths = dict(zip(labelled, pool.map(lambda n: fetch('https://www.cp.jku.at/datasets/giantsteps/backup/', f'{gk}/md5', n), labelled)))
for n, p in paths.items():
    if not p: failed.append(f'gs:{n}'); continue
    g = f'{gk}/annotations/genre/{n}.genre'
    d = dur(p); base = {'track': f'gs:{n}', 'path': p, 'truth': labelled[n], 'duration': round(d, 2), 'set': 'gs-key',
                        'genre': slug(open(g).read()) if os.path.exists(g) else ''}
    rows.append({**base, 'id': f'gs-{n}-mid10', 'plan': 'excerpt', 'start': round(max(0.0, d / 2 - 5), 3), 'seconds': 10})
    rows.append({**base, 'id': f'gs-{n}-song', 'plan': 'song', 'start': 0, 'seconds': d})
    rows.append({**base, 'id': f'gs-{n}-blocks', 'plan': 'blocks', 'start': 0, 'seconds': d})

# GTZAN with Lerch's key annotations
with tarfile.open(gtzan_tgz, 'r|gz') as tf:
    for m in tf:
        name = os.path.basename(m.name)
        if not m.isfile() or not name.endswith('.wav') or name.startswith('._') or not mine(name): continue
        genre, num = name[:-4].split('.')   # blues.00015.wav
        ann = f'{gzk}/gtzan_key/genres/{genre}/{genre}.{num}.lerch.txt'
        if not os.path.exists(ann): continue
        try: label = int(open(ann).read().strip())
        except ValueError: continue
        if not 0 <= label <= 23: continue
        p = f'{out}/audio/{name}'; open(p, 'wb').write(tf.extractfile(m).read())
        try: d = dur(p)
        except ValueError: os.remove(p); continue   # GTZAN has one known-corrupt file
        split = 'tune-gtzan' if int(h('gtzan-key-split', name)[:8], 16) % 2 == 0 else 'test-gtzan'
        rows.append({'set': split, 'id': f'gz-{genre}-{num}', 'track': f'gtzan:{name}', 'genre': genre, 'path': p, 'plan': 'excerpt',
                     'start': 0, 'seconds': d, 'duration': round(d, 2),
                     'truth': {'tonic': TONICS[GTZAN_ORDER[label % 12]], 'mode': 'major' if label < 12 else 'minor'}})

json.dump(rows, open(f'{out}/clips.json', 'w'))
# Tracks whose audio no source serves any more are listed, not silently dropped; the collect job commits the list.
json.dump(sorted(failed), open(f'{out}/unavailable.json', 'w'))
counts = {}
for r in rows: counts[r['set']] = counts.get(r['set'], 0) + 1
print(f'shard {shard}: {counts}; {len(failed)} tracks unavailable from every source')
