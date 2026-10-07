"""SoundCloud tracks labelled from their own descriptions (the "Train on labelled SoundCloud tracks" thread) for the tagger.

Usage: python3 scripts/audio-model/prepare-soundcloud.py <manifest.json> <audio-dir> <out-dir>

<audio-dir> holds the 30 s excerpts as <id>.mp3 (scripts/soundcloud/collect.py). The manifest splits tracks by uploader:
  * fold "train"    -> three 10 s windows per track as log-mel input: soundcloud-mel.npy + soundcloud.json (train.py);
  * fold "held-out" -> the 30 s excerpt as 32 kHz int16: soundcloud-heldout.npy + .json (evaluate.py, judging only).
Labels come from text, not ears: a stated instrument is present; an absence the labeller inferred because the class was
"left out of" a listed line-up is weak (train.py down-weights it, evaluate.py scores it only in the weak view).
"""
import json, os, subprocess, sys, warnings
import numpy as np
warnings.filterwarnings('ignore')
import torch
sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
from models.preprocess import AugmentMelSTFT  # noqa: E402

manifest, audio, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
items = json.load(open(manifest))['items']
L = 960000

def decode(it):
    path = os.path.join(audio, it['id'] + '.mp3')
    if not os.path.exists(path): return None
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '32000', '-f', 's16le', 'pipe:1'], capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, np.int16)[:L]
    return np.pad(x, (0, L - len(x)))

def labels(it):
    rv = [r for r in it['reviews']]
    return ({r['label']: r['state'] for r in rv}, [r['label'] for r in rv if r['state'] == 'absent' and 'left out' in r.get('evidence', '')])

train, mels, held, held_wav, missing = [], [], [], [], 0
for it in items:
    x = decode(it)
    if x is None: missing += 1; continue
    lab, weak = labels(it)
    if it['fold'] == 'train':
        with torch.no_grad():
            m = mel(torch.from_numpy(x.reshape(3, 320000).astype(np.float32) / 32768))[:, :, :1000].numpy().astype(np.float16)
        for k in range(3):
            train.append({'id': f'{it["id"]}@{k * 10}', 'artist': it['groups']['artist'], 'row': len(mels), 'dj': True,
                          'labels': {c: float(s == 'present') for c, s in lab.items()}, 'weakAbsent': weak}); mels.append(m[k])
    else:
        held.append({'id': it['id'], 'artist': it['groups']['artist'], 'genre': it.get('genre'), 'labels': lab, 'weak': weak}); held_wav.append(x)
np.save(os.path.join(out, 'soundcloud-mel.npy'), np.stack(mels))
json.dump({'source': manifest, 'items': train}, open(os.path.join(out, 'soundcloud.json'), 'w'))
np.save(os.path.join(out, 'soundcloud-heldout.npy'), np.stack(held_wav))
json.dump({'source': manifest, 'items': held}, open(os.path.join(out, 'soundcloud-heldout.json'), 'w'))
print(f'{len(train)} train windows from {len(train) // 3} tracks; {len(held)} held-out tracks; {missing} tracks without audio')
