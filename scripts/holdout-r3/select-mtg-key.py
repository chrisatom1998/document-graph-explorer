"""Freeze the round 3 held-out tempo and key set: GiantSteps MTG key tracks that round 2 did not use, split by a hash.

Usage: python3 scripts/holdout-r3/select-mtg-key.py <giantsteps-mtg-key-dataset checkout> <round 2 track list> <audio-out-dir>

Round 2 (PR #119) used 500 of the dataset's 1486 Beatport tracks. Of the rest, a track is held out when
int(sha256("dge-holdout-r3-2026-10-06|" + name)[:8], 16) is even; the other half stays free for tuning. This rule was
sent to the key and tempo threads before any of them read these tracks. Every held-out track that has a Beatport BPM
and whose preview downloads from the dataset's JKU backup with the published MD5 is kept. Each excerpt is the middle
10 s of the preview, decoded to 44.1 kHz stereo WAV, exactly as in round 2. Tempo truth: the Beatport BPM (label
metadata; Beatport lists most drum & bass at half tempo). Key truth: the manual key and its confidence (2 is the
annotators' top confidence). Audio is never committed.
"""
import concurrent.futures, csv, hashlib, json, os, subprocess, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'holdout-r3-2026-10-06')
SPLIT_SEED, SEED, CLIP = 'dge-holdout-r3-2026-10-06', 'dge-holdout-r3-mtg-key-2026-10-06', 10.0
BASE = 'https://www.cp.jku.at/datasets/giantsteps/mtg_key_backup/'
TONICS = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
repo, round2, audio_out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(audio_out, exist_ok=True); os.makedirs(OUT, exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
held_out = lambda name: int(h(SPLIT_SEED, name)[:8], 16) % 2 == 0
table = lambda f: list(csv.DictReader(open(os.path.join(repo, 'annotations', f)), delimiter='\t'))
meta = {r['ID'].strip(): r for r in table('beatport_metadata.txt')}
manual = {r['ID'].strip(): r for r in table('annotations.txt')}
used = set(open(round2).read().split())   # round2-mtg-key-tracks.txt: the sampleKeys of PR #119's mtg-key-manifest.json
if len(used) != 500: sys.exit(f'round 2 list has {len(used)} tracks, expected 500')

def key_of(text):
    parts = text.strip().split()
    if len(parts) != 2 or parts[0] not in TONICS or parts[1] not in ('major', 'minor'): return None
    return {'tonic': TONICS[parts[0]], 'mode': parts[1], 'label': text.strip()}

names = sorted(f[:-len('.md5')] for f in os.listdir(os.path.join(repo, 'md5')))   # e.g. 100066.LOFI
unused = [n for n in names if n not in used]
names = [n for n in unused if held_out(n) and (meta.get(n.split('.')[0], {}).get('BP BPM') or '').strip()]
names.sort(key=lambda n: h(SEED, n))
path = f'{OUT}/mtg-key-manifest.json'
frozen = json.load(open(path))['items'] if os.path.exists(path) else None
clip_id = lambda n: f"h3k-{h(SEED, n)[:16]}"

def fetch(n):
    """Download, verify and cut one track; returns the excerpt start on success, None otherwise."""
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
    return round(start, 3)

with concurrent.futures.ThreadPoolExecutor(4) as pool:
    starts = dict(zip(names, pool.map(fetch, names)))
failed = [n for n in names if starts[n] is None]
keep = [n for n in names if starts[n] is not None]
if frozen:
    missing = {it['sampleKey'] for it in frozen} - set(keep)
    if missing: sys.exit(f'{len(missing)} frozen tracks could not be fetched again, e.g. {sorted(missing)[:5]}')
    keep = [it['sampleKey'] for it in frozen]
    for n in set(names) - set(keep):
        if starts[n] is not None: os.remove(os.path.join(audio_out, clip_id(n) + '.wav'))   # newly reachable: not in the frozen set
if len(keep) < 300: sys.exit(f'only {len(keep)} previews downloaded; {len(failed)} failed, e.g. {failed[:5]}')

items = []
for n in keep:
    tid = n.split('.')[0]; m = meta[tid]; a = manual.get(tid, {}); bpm = float(m['BP BPM'])
    items.append({'id': clip_id(n), 'source': f'GiantSteps MTG key {n}.mp3 (Beatport preview)',
                  'rights': {'evaluationAllowed': True, 'basis': 'GiantSteps MTG key dataset (research use); audio fetched at run time, never committed'},
                  'groups': {'original': f'mtg-key:{n}', 'artist': f"beatport-artist:{m['ARTIST'].strip()}", 'pack': 'mtg-key', 'sampleFamily': f'mtg-key:{n}'},
                  'genre': m['BP GENRE'].strip().lower().replace(' & ', '-and-').replace(' ', '-'), 'sampleKey': n, 'start': starts[n],
                  'end': round(starts[n] + CLIP, 3), 'split': 'test', 'tier': 'song', 'transformations': [], 'reviews': [],
                  'tempo': {'bpm': bpm, 't1': bpm, 't2': 0, 'salienceT1': 1, 'source': 'Beatport BPM'},
                  'key': {**(key_of(a.get('MANUAL KEY', '')) or {'label': a.get('MANUAL KEY', '').strip() or None}),
                          'confidence': int(a['C']) if a.get('C', '').strip().isdigit() else None}})
if frozen and [it['id'] for it in frozen] != [it['id'] for it in items]: sys.exit('Computed selection differs from the frozen manifest.')
if not frozen:
    json.dump({'version': 1, 'frozenAt': '2026-10-06T05:00:00Z', 'seed': SEED, 'selection': __doc__.strip(), 'items': items},
              open(path, 'w'), indent=1)
genres = {}
for it in items: genres[it['genre']] = genres.get(it['genre'], 0) + 1
print(f'{len(unused)} tracks unused by round 2; {len(names)} held out with a BPM; {len(items)} kept; {len(failed)} downloads failed; '
      f'{sum(1 for it in items if "tonic" in it["key"] and it["key"]["confidence"] == 2)} with a confident single key; genres {genres}')
