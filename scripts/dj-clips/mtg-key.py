"""Freeze 500 10 s excerpts of Beatport EDM previews from the GiantSteps MTG key dataset (round 2 of the DJ clip test).

Usage: python3 scripts/dj-clips/mtg-key.py <giantsteps-mtg-key-dataset checkout> <audio-out-dir>

Selection is label-blind: the 1486 tracks (none shared with the GiantSteps tempo set that round 1 and the tempo tuning
set draw from) that carry a Beatport BPM are ranked by a seeded hash, and the first 500 whose preview downloads from
the dataset's JKU backup with the published MD5 are kept. Each excerpt is the middle 10 s of the preview, decoded to
44.1 kHz stereo WAV. Tempo truth: the Beatport BPM in annotations/beatport_metadata.txt (label metadata, not crowd
corrected like round 1's v2 labels). Key truth: the manual key in annotations/annotations.txt with its confidence (2 is
the annotators' top confidence; "-" or two keys means no single key). Genre: Beatport genre. Audio is never committed.
"""
import concurrent.futures, csv, hashlib, json, os, subprocess, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'dj-clips-round2-2026-10-06')
SEED, MAX_ITEMS, CLIP = 'dge-dj-clips-mtg-key-2026-10-06', 500, 10.0
BASE = 'https://www.cp.jku.at/datasets/giantsteps/mtg_key_backup/'
TONICS = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
repo, audio_out = sys.argv[1], sys.argv[2]
os.makedirs(audio_out, exist_ok=True); os.makedirs(OUT, exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
table = lambda f: list(csv.DictReader(open(os.path.join(repo, 'annotations', f)), delimiter='\t'))
meta = {r['ID'].strip(): r for r in table('beatport_metadata.txt')}
manual = {r['ID'].strip(): r for r in table('annotations.txt')}

def key_of(text):
    parts = text.strip().split()
    if len(parts) != 2 or parts[0] not in TONICS or parts[1] not in ('major', 'minor'): return None
    return {'tonic': TONICS[parts[0]], 'mode': parts[1], 'label': text.strip()}

names = sorted(f[:-len('.md5')] for f in os.listdir(os.path.join(repo, 'md5')))   # e.g. 100066.LOFI
names = [n for n in names if (meta.get(n.split('.')[0], {}).get('BP BPM') or '').strip()]
names.sort(key=lambda n: h(SEED, n))
path = f'{OUT}/mtg-key-manifest.json'
frozen = json.load(open(path))['items'] if os.path.exists(path) else None
if frozen: names = [it['sampleKey'] for it in frozen]
clip_id = lambda n: f"mk-{h(SEED, n)[:16]}"

def fetch(n):
    """Download, verify and cut one track; returns (n, start) on success, None otherwise."""
    tmp = os.path.join(audio_out, n + '.mp3')
    want = open(os.path.join(repo, 'md5', n + '.md5')).read().split()[0]
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(BASE + n + '.mp3', timeout=60).read()
            if hashlib.md5(data).hexdigest() == want: break
        except Exception: pass
        time.sleep(2 ** attempt)
    else: return None
    open(tmp, 'wb').write(data)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp], capture_output=True, text=True).stdout)
    start = max(0.0, dur / 2 - CLIP / 2)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', str(CLIP), '-i', tmp, '-ar', '44100', '-ac', '2',
                    os.path.join(audio_out, clip_id(n) + '.wav')], check=True)
    os.remove(tmp)
    return n, round(start, 3)

kept, failed = {}, []
with concurrent.futures.ThreadPoolExecutor(4) as pool:
    for i in range(0, len(names), 40):           # in batches so we stop once 500 are in hand
        for n, r in zip(names[i:i + 40], pool.map(fetch, names[i:i + 40])):
            if r: kept[n] = r[1]
            else: failed.append(n)
        if len(kept) >= MAX_ITEMS: break
keep = [n for n in names if n in kept][:MAX_ITEMS]
for n in set(kept) - set(keep): os.remove(os.path.join(audio_out, clip_id(n) + '.wav'))   # batch overshoot
if frozen and len(keep) != len(frozen): sys.exit(f'{len(frozen) - len(keep)} frozen clips could not be fetched again: {failed[:5]}')
if len(keep) < MAX_ITEMS: sys.exit(f'only {len(keep)} of {MAX_ITEMS} previews downloaded; {len(failed)} failed, e.g. {failed[:5]}')

items = []
for n in keep:
    tid = n.split('.')[0]; m = meta[tid]; a = manual.get(tid, {})
    bpm = float(m['BP BPM'])
    items.append({'id': clip_id(n), 'source': f'GiantSteps MTG key {n}.mp3 (Beatport preview)',
                  'rights': {'evaluationAllowed': True, 'basis': 'GiantSteps MTG key dataset (research use); audio fetched at run time, never committed'},
                  'groups': {'original': f'mtg-key:{n}', 'artist': f"beatport-artist:{m['ARTIST'].strip()}", 'pack': 'mtg-key', 'sampleFamily': f'mtg-key:{n}'},
                  'genre': m['BP GENRE'].strip().lower().replace(' & ', '-and-').replace(' ', '-'), 'sampleKey': n, 'start': kept[n],
                  'end': round(kept[n] + CLIP, 3), 'split': 'test', 'tier': 'song', 'transformations': [], 'reviews': [],
                  # t1/t2 mirror round 1's fields so the same scorer runs; Beatport gives a single tempo.
                  'tempo': {'bpm': bpm, 't1': bpm, 't2': 0, 'salienceT1': 1, 'source': 'Beatport BPM'},
                  'key': {**(key_of(a.get('MANUAL KEY', '')) or {'label': a.get('MANUAL KEY', '').strip() or None}),
                          'confidence': int(a['C']) if a.get('C', '').strip().isdigit() else None}})
if frozen and [it['id'] for it in frozen] != [it['id'] for it in items]: sys.exit('Computed selection differs from the frozen manifest.')
if not frozen:
    json.dump({'version': 1, 'frozenAt': '2026-10-06T03:00:00Z', 'seed': SEED, 'selection': __doc__.strip().split('\n\n')[2], 'items': items},
              open(path, 'w'), indent=1)
genres = {}
for it in items: genres[it['genre']] = genres.get(it['genre'], 0) + 1
print(f'{len(items)} excerpts kept; {len(failed)} downloads failed; {sum(1 for it in items if "tonic" in it["key"] and it["key"]["confidence"] == 2)} with a confident single key; genres {genres}')
