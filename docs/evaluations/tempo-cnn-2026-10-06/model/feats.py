"""Key and tempo input features for DGE learned models (browser-reproducible: STFT + fixed filterbanks).
key:   22050 Hz mono, Hann 8192, hop 4410 (5 fps), 144 quarter-tone bins MIDI 36..107.5, log1p(1000*x)
tempo: 11025 Hz mono, Hann 1024, hop 512 (21.5 fps), 40 mel bands 20-5000 Hz, log1p(1000*x)
Usage: feats.py <items.json [{id,path,start?,seconds?}]> <out-dir>"""
import json, os, subprocess, sys, numpy as np
from concurrent.futures import ProcessPoolExecutor

def load(path, sr, start=None, seconds=None):
    cmd = ['ffmpeg', '-nostdin', '-v', 'error']
    if start: cmd += ['-ss', str(start)]
    if seconds: cmd += ['-t', str(seconds)]
    cmd += ['-i', path, '-af', 'pan=mono|c0=0.5*c0+0.5*c1' if False else 'aformat=channel_layouts=mono', '-ar', str(sr), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def stft_mag(x, n, hop):
    if len(x) < n: x = np.pad(x, (0, n - len(x)))
    w = np.hanning(n + 1)[:-1].astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop]
    return np.abs(np.fft.rfft(frames * w, axis=1)).astype(np.float32) / np.sqrt(n)

def tri_bank(centers, sr, n):
    freqs = np.arange(n // 2 + 1) * sr / n
    fb = np.zeros((len(centers) - 2, len(freqs)), np.float32)
    for i in range(1, len(centers) - 1):
        lo, c, hi = centers[i - 1], centers[i], centers[i + 1]
        up = (freqs - lo) / (c - lo); down = (hi - freqs) / (hi - c)
        fb[i - 1] = np.maximum(0, np.minimum(up, down))
        if fb[i - 1].sum() == 0: fb[i - 1, np.argmin(abs(freqs - c))] = 1
    return fb

midi = 36 + np.arange(-1, 145) / 2
KEY_FB = tri_bank(440 * 2 ** ((midi - 69) / 12), 22050, 8192)          # 144 bins
def mel(f): return 2595 * np.log10(1 + f / 700)
def imel(m): return 700 * (10 ** (m / 2595) - 1)
TEMPO_FB = tri_bank(imel(np.linspace(mel(20), mel(5000), 42)), 11025, 1024)  # 40 bands

def one(item):
    out = sys.argv[2]
    p = f"{out}/{item['id'].replace('/', '_').replace(':', '_')}.npz"
    if os.path.exists(p): return 1
    try:
        x = load(item['path'], 22050, item.get('start'), item.get('seconds'))
        if len(x) < 22050: return 0
        k = np.log1p(1000 * stft_mag(x, 8192, 4410) @ KEY_FB.T).astype(np.float16)
        y = load(item['path'], 11025, item.get('start'), item.get('seconds'))
        t = np.log1p(1000 * stft_mag(y, 1024, 512) @ TEMPO_FB.T).astype(np.float16)
        np.savez(p, key=k, tempo=t)
        return 1
    except Exception as e:
        print('fail', item['id'], e, flush=True); return 0

if __name__ == '__main__':
    items = json.load(open(sys.argv[1])); os.makedirs(sys.argv[2], exist_ok=True)
    with ProcessPoolExecutor(int(os.environ.get('J', 4))) as ex:
        ok = sum(ex.map(one, items, chunksize=4))
    print(ok, 'of', len(items))
