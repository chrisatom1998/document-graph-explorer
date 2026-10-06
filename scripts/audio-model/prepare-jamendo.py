"""MTG-Jamendo training windows for DGE's own instrument tagger: split-0 train and validation tracks only.

Usage: python3 scripts/audio-model/prepare-jamendo.py <mtg-jamendo metadata dir> <holdout-manifest.json> <out-dir>
       [--windows 2] [--parallel 3]

<metadata dir> holds data/raw_30s_cleantags.tsv, data/splits/split-0/autotagging_instrument-{train,validation,test}.tsv,
derived/music-classification-annotations/music-classification-annotations-clean.tsv and
data/download/raw_30s_audio-low_sha256_tracks.txt from MTG/mtg-jamendo-dataset.

Held out, never read: every split-0 test track and every artist in the round 3 held-out manifest (PR #121), which is
drawn from split-0 test. Each track's audio-low MP3 is checked against the dataset's SHA-256, then <windows> 10 s
windows spread across the track are decoded at 32 kHz mono and stored as the tagger's log-mel input (float16
[N, 128, 1000], the EfficientAT front end in eval mode), so 20,000 tracks fit in about 10 GB.

Labels (OpenMIC class names): an uploader instrument tag is present (relevance 1); a mapped class the uploader did not
tag is a weak absent (relevance 0, flagged so training can down-weight it). Voice uses the three-annotator
voice/instrumental agreement where it exists. Classes Jamendo has no tag for (cymbals, banjo, mandolin, ukulele,
mallet percussion) stay unknown.
"""
import argparse, csv, hashlib, json, os, subprocess, sys, tarfile, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import warnings
import numpy as np
warnings.filterwarnings("ignore")

URL = 'https://cdn.freesound.org/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'
MAP = {'accordion': ['accordion'], 'bass': ['bass', 'doublebass', 'acousticbassguitar'], 'cello': ['cello'],
       'clarinet': ['clarinet'], 'drums': ['drums', 'drummachine'], 'flute': ['flute'],
       'guitar': ['guitar', 'acousticguitar', 'electricguitar', 'classicalguitar'], 'organ': ['organ', 'pipeorgan'],
       'piano': ['piano', 'electricpiano', 'rhodes'], 'saxophone': ['saxophone'], 'synthesizer': ['synthesizer'],
       'trombone': ['trombone'], 'trumpet': ['trumpet'], 'violin': ['violin'], 'voice': ['voice']}
SR, N = 32000, 320000

ap = argparse.ArgumentParser()
ap.add_argument('meta'); ap.add_argument('holdout'); ap.add_argument('out')
ap.add_argument('--windows', type=int, default=2); ap.add_argument('--parallel', type=int, default=3)
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

def tsv(name):
    rows = []
    for line in open(os.path.join(args.meta, 'data', 'splits', 'split-0', name)).read().splitlines()[1:]:
        f = line.rstrip().split('\t')
        rows.append({'track': f[0], 'artist': f[1], 'path': f[3], 'duration': float(f[4]), 'tags': {t.split('---')[1] for t in f[5:] if t}})
    return rows
test = tsv('autotagging_instrument-test.tsv')
held_artists = {t['artist'] for t in test}
held_artists |= {it['groups']['artist'].split(':', 1)[1] for it in json.load(open(args.holdout))['items']}
held_tracks = {t['track'] for t in test} | {it['groups']['original'].split(':', 1)[1] for it in json.load(open(args.holdout))['items']}
tracks = [t for t in tsv('autotagging_instrument-train.tsv') + tsv('autotagging_instrument-validation.tsv')
          if t['artist'] not in held_artists and t['track'] not in held_tracks]
print(f'{len(tracks)} train/validation tracks; held out {len(held_tracks)} tracks and {len(held_artists)} artists', flush=True)

voice = {}
for line in open(os.path.join(args.meta, 'derived', 'music-classification-annotations', 'music-classification-annotations-clean.tsv')).read().splitlines()[1:]:
    f = line.split('\t')
    for a in f[5:]:
        if a.startswith('voice_instrumental---'):
            votes = a.split('---')[1].split(',')
            if len(set(votes)) == 1: voice[f[0]] = votes[0] == 'voice'
# DJ and electronic genres, as the round 3 set ranks them (scripts/holdout-r3/select-jamendo.py): oversampled in training.
DJ_GENRES = {'house', 'techno', 'trance', 'dance', 'drumnbass', 'dubstep', 'electronica', 'hiphop', 'chillout', 'downtempo', 'idm',
             'breakbeat', 'deephouse', 'minimal', 'electropop', 'edm', 'triphop', 'rap', 'electro', 'club', 'garage', 'synthpop', 'dub', 'electronic'}
genres = {}
for line in open(os.path.join(args.meta, 'data', 'raw_30s_cleantags.tsv')).read().splitlines()[1:]:
    f = line.rstrip().split('\t'); genres[f[0]] = sorted(t.split('---')[1] for t in f[5:] if t.startswith('genre---'))
sha = {}
for line in open(os.path.join(args.meta, 'data', 'download', 'raw_30s_audio-low_sha256_tracks.txt')):
    h, p = line.split(); sha[p] = h

items, rows = [], 0
for t in tracks:
    labels = {c: float(any(n in t['tags'] for n in names)) for c, names in MAP.items()}
    weak = [c for c, v in labels.items() if not v]
    if t['track'] in voice: labels['voice'] = float(voice[t['track']]); weak = [c for c in weak if c != 'voice']
    d = t['duration']; length = min(10, d)
    starts = [round(max(0, d * (k + 1) / (args.windows + 1) - length / 2), 2) for k in range(args.windows)]
    for k, s in enumerate(starts):
        items.append({'id': f'{t["track"]}@{s}', 'track': t['track'], 'artist': t['artist'], 'archivePath': t['path'].replace('.mp3', '.low.mp3'),
                      'start': s, 'labels': labels, 'weakAbsent': weak, 'row': rows,
                      'genres': genres.get(t['track'], []), 'dj': bool(DJ_GENRES & set(genres.get(t['track'], [])))}); rows += 1
mel_out = np.lib.format.open_memmap(os.path.join(args.out, 'jamendo-mel.npy'), mode='w+', dtype=np.float16, shape=(rows, 128, 1000))
done = np.zeros(rows, bool)

import torch  # noqa: E402
sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
from models.preprocess import AugmentMelSTFT  # noqa: E402
torch.set_num_threads(1)
mel = AugmentMelSTFT(n_mels=128, sr=SR, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
lock = threading.Lock()

def windows(data, its):
    out = []
    for it in its:
        pcm = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(it['start']), '-t', '10', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR),
                              '-f', 's16le', 'pipe:1'], input=data, capture_output=True, check=True).stdout
        x = np.frombuffer(pcm, dtype=np.int16)[:N]; out.append(np.pad(x, (0, N - len(x))).astype(np.float32) / 32768)
    with torch.no_grad(): m = mel(torch.from_numpy(np.stack(out)))[:, :, :1000].numpy().astype(np.float16)
    return m

by_path = {}
for it in items: by_path.setdefault(it['archivePath'], []).append(it)
def folder(f):
    needed = {p: v for p, v in by_path.items() if int(p.split('/')[0]) == f}
    for attempt in range(5):
        got = set()
        try:
            with urllib.request.urlopen(URL.format(f), timeout=120) as res, tarfile.open(fileobj=res, mode='r|') as tar:
                for m in tar:
                    rel = '/'.join(m.name.split('/')[-2:])
                    if not m.isfile() or rel not in needed or rel in got: continue
                    data = tar.extractfile(m).read()
                    if hashlib.sha256(data).hexdigest() != sha[rel]: raise ValueError(f'checksum mismatch for {rel}')
                    its = needed[rel]
                    mels = windows(data, its)
                    with lock:
                        for it, x in zip(its, mels): mel_out[it['row']] = x; done[it['row']] = True
                    got.add(rel)
                    if len(got) == len(needed): break
            return f, len(got), len(needed)
        except Exception as e:
            print(f'folder {f:02d} attempt {attempt + 1}: {e}', flush=True); time.sleep(2 ** attempt * 5)
    return f, len(got), len(needed)

t0 = time.time()
with ThreadPoolExecutor(args.parallel) as pool:
    for f, got, needed in pool.map(folder, range(100)):
        print(f'folder {f:02d}: {got}/{needed} tracks, {done.sum()} windows, {time.time() - t0:.0f}s', flush=True)
mel_out.flush()
kept = [dict(it, row=i) for i, it in enumerate(items)]
json.dump({'source': 'MTG-Jamendo split-0 train+validation (instrument), round 3 held-out artists removed',
           'items': [it for it in kept if done[it['row']]]}, open(os.path.join(args.out, 'jamendo.json'), 'w'))
print(f'{done.sum()}/{rows} windows from {len({it["track"] for it in items if done[it["row"]]})} tracks')
