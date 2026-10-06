"""Freeze 500 10 s excerpts of Beatport EDM previews with human tempo labels (GiantSteps tempo dataset).

Usage: python3 scripts/dj-clips/giantsteps.py <giantsteps-tempo-dataset checkout> <audio-out-dir>

Selection is label-blind: the 661 tracks with a v2 tempo (Schreiber & Mueller 2018 crowd annotations) are ranked by a
seeded hash and the first 500 whose preview downloads from the dataset's JKU backup with the published MD5 are kept.
Each excerpt is the middle 10 s of the preview, decoded to 44.1 kHz stereo WAV. Tempo truth: annotations_v2/mirex
(T1, T2, salience of T1); the Beatport genre comes from annotations/genre. No instrument labels exist for these clips.
Audio is fetched at run time and never committed.
"""
import concurrent.futures, hashlib, json, os, subprocess, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'dj-clips-2026-10-06')
SEED, MAX_ITEMS, CLIP = 'dge-dj-clips-giantsteps-2026-10-06', 500, 10.0
BASE = 'https://www.cp.jku.at/datasets/giantsteps/backup/'
repo, audio_out = sys.argv[1], sys.argv[2]
os.makedirs(audio_out, exist_ok=True); os.makedirs(OUT, exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
rd = lambda *p: open(os.path.join(repo, *p)).read().strip()

names = sorted(f[:-len('.bpm')] for f in os.listdir(os.path.join(repo, 'annotations_v2', 'tempo')))   # e.g. 1030011.LOFI
names = [n for n in names if float(rd('annotations_v2', 'tempo', n + '.bpm')) > 0]
names.sort(key=lambda n: h(SEED, n))
path = f'{OUT}/giantsteps-manifest.json'
frozen = json.load(open(path))['items'] if os.path.exists(path) else None
if frozen: names = [it['sampleKey'] for it in frozen]

def fetch(n):
    """Download, verify and cut one track; returns n on success, None otherwise."""
    tmp = os.path.join(audio_out, n + '.mp3')
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(BASE + n + '.mp3', timeout=60).read()
            if hashlib.md5(data).hexdigest() == rd('md5', n + '.md5').split()[0]: break
        except Exception: pass
        time.sleep(2 ** attempt)
    else: return None
    open(tmp, 'wb').write(data)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp], capture_output=True, text=True).stdout)
    start = max(0.0, dur / 2 - CLIP / 2)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', str(CLIP), '-i', tmp, '-ar', '44100', '-ac', '2',
                    os.path.join(audio_out, f"gs-{h(SEED, n)[:16]}.wav")], check=True)
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
for n in set(kept) - set(keep): os.remove(os.path.join(audio_out, f"gs-{h(SEED, n)[:16]}.wav"))   # batch overshoot
if frozen and len(keep) != len(frozen): sys.exit(f'{len(frozen) - len(keep)} frozen clips could not be fetched again: {failed[:5]}')
if len(keep) < 100: sys.exit(f'only {len(keep)} previews downloaded; {len(failed)} failed, e.g. {failed[:5]}')

items = []
for n in keep:
    t1, t2, s1 = (float(x) for x in rd('annotations_v2', 'mirex', n + '.mirex').split())
    items.append({'id': f'gs-{h(SEED, n)[:16]}', 'source': f'GiantSteps tempo {n}.mp3 (Beatport preview)',
                  'rights': {'evaluationAllowed': True, 'basis': 'GiantSteps tempo dataset (research use); audio fetched at run time, never committed'},
                  'groups': {'original': f'giantsteps:{n}', 'artist': f'giantsteps:{n}', 'pack': 'giantsteps', 'sampleFamily': f'giantsteps:{n}'},
                  'genre': rd('annotations', 'genre', n + '.genre'), 'sampleKey': n, 'start': kept[n], 'end': round(kept[n] + CLIP, 3), 'split': 'test',
                  'tier': 'song', 'transformations': [], 'reviews': [],
                  'tempo': {'bpm': float(rd('annotations_v2', 'tempo', n + '.bpm')), 't1': t1, 't2': t2, 'salienceT1': s1,
                            'v1': float(rd('annotations', 'tempo', n + '.bpm'))}})
if frozen and [it['id'] for it in frozen] != [it['id'] for it in items]: sys.exit('Computed selection differs from the frozen manifest.')
if not frozen:
    json.dump({'version': 1, 'frozenAt': '2026-10-06T01:00:00Z', 'seed': SEED, 'selection': __doc__.strip().split('\n\n')[2], 'items': items},
              open(path, 'w'), indent=1)
print(f'{len(items)} excerpts kept; {len(failed)} downloads failed')
