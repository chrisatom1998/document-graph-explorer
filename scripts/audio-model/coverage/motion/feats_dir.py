"""Motion features for every <id>.flac (16 kHz mono) in a folder -> jsonl. Audio is upsampled to the app's 32 kHz first,
so the numbers match what the rules see on the stored copies. Usage: python3 -I feats_dir.py <dir> <out.jsonl>"""
import json, os, subprocess, sys
from multiprocessing import Pool
import numpy as np
from scipy.signal import resample_poly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motion_features import motion_features, SR

def bands(x):
    x = x[:SR * 12]
    p = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2; hz = np.fft.rfftfreq(len(x), 1 / SR)
    tot = p[(hz >= 20) & (hz < 16000)].sum() + 1e-20
    return {f'above{k}': float(p[(hz >= k) & (hz < 16000)].sum() / tot) for k in (1000, 2000, 4000, 8000)}

def load16(path):
    b = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], capture_output=True).stdout
    return np.frombuffer(b, np.int16).astype(np.float64) / 32768

def one(path):
    x = load16(path)
    if len(x) < 1600: return None
    x = resample_poly(x, 2, 1)
    f = motion_features(x)
    if f is None: return None
    f.update(bands(x)); f['id'] = os.path.basename(path).rsplit('.', 1)[0]
    return f

if __name__ == '__main__':
    d, out = sys.argv[1:3]
    files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith('.flac'))
    with Pool(4) as p, open(out, 'w') as o:
        for f in p.imap(one, files, chunksize=4):
            if f: o.write(json.dumps(f) + '\n')
