"""Cuts a short window at each target's start in the held-out test mixes, for the one-shot detectors.

Window: 50 ms before the target starts to 2.0 s after (2.05 s, under the 2.25 s one-shot limit), taken
from the same 48 kHz mono mix, so the drum loop underneath stays in. This uses the KNOWN start (an
upper bound); a real song needs an onset finder to pick the starts.
Usage: cut-event-windows.py <test manifest.json> <out dir>"""
import json, sys, os, wave
import numpy as np

src, out = sys.argv[1:3]; os.makedirs(f'{out}/audio', exist_ok=True)
BEFORE, AFTER = 0.05, 2.0
clips = []
for c in json.load(open(src))['clips']:
    with wave.open(c['path']) as w: rate = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), '<i2')
    a = max(0, int((c['startSeconds'] - BEFORE) * rate)); b = min(len(x), int((c['startSeconds'] + AFTER) * rate))
    path = f"{out}/audio/{c['id'][4:]}.wav"
    with wave.open(path, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(x[a:b].tobytes())
    clips.append({**c, 'id': 'win:' + c['id'][4:], 'path': path, 'windowSeconds': (b - a) / rate})
json.dump({'kind': 'event-windows-v1', 'source': src, 'clips': clips}, open(f'{out}/test.json', 'w'))
print(len(clips), 'windows,', f"{np.mean([c['windowSeconds'] for c in clips]):.2f} s average")
