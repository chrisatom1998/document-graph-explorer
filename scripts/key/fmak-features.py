"""Key-network input features for FMAKv2 (5,489 Free Music Archive songs with key and mode, Zenodo 12759100,
CC BY 4.0 annotations; audio from the FMAK record, Zenodo 10719860). Extra training data for the key network: none of
these songs is in any key judging set (GiantSteps, round 2/3 Beatport tracks, GTZAN).

Same features as /mnt/project-files/models/key-cnn-2026-10-06/feats.py (22050 Hz mono, Hann 8192, hop 4410, 144
quarter-tone bins MIDI 36..107.5, log1p(1000*x)), over the middle 120 s of each song, stored as uint8 (value * 20).
Usage: python3 scripts/key/fmak-features.py <fmakv2.csv> <audio dir with NNN/NNNNNN.mp3> <out dir>
"""
import csv, os, subprocess, sys, numpy as np
from concurrent.futures import ProcessPoolExecutor

TONICS = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8,
          'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
SR, N, HOP, KEEP = 22050, 8192, 4410, 600   # 600 frames = 120 s

def tri_bank(centers):
    freqs = np.arange(N // 2 + 1) * SR / N
    fb = np.zeros((len(centers) - 2, len(freqs)), np.float32)
    for i in range(1, len(centers) - 1):
        lo, c, hi = centers[i - 1], centers[i], centers[i + 1]
        fb[i - 1] = np.maximum(0, np.minimum((freqs - lo) / (c - lo), (hi - freqs) / (hi - c)))
        if fb[i - 1].sum() == 0: fb[i - 1, np.argmin(abs(freqs - c))] = 1
    return fb

midi = 36 + np.arange(-1, 145) / 2
FB = tri_bank(440 * 2 ** ((midi - 69) / 12))

def one(job):
    path, out = job
    try:
        raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-af', 'aformat=channel_layouts=mono',
                              '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, timeout=600).stdout
        x = np.frombuffer(raw, np.float32)
        if len(x) < 10 * SR: return 0
        w = np.hanning(N + 1)[:-1].astype(np.float32)
        frames = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP]
        if len(frames) > KEEP: o = (len(frames) - KEEP) // 2; frames = frames[o:o + KEEP]
        mag = np.abs(np.fft.rfft(frames * w, axis=1)).astype(np.float32) / np.sqrt(N)
        k = np.log1p(1000 * mag @ FB.T)
        np.savez_compressed(out, key=np.clip(np.round(k * 20), 0, 255).astype(np.uint8), seconds=len(x) / SR)
        return 1
    except Exception as e:
        print('fail', path, e, flush=True); return 0

if __name__ == '__main__':
    labels, audio, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    jobs = []
    for r in csv.DictReader(open(labels)):
        t = int(r['track_id']); p = f'{audio}/{t // 1000:03d}/{t:06d}.mp3'
        if os.path.exists(p) and not os.path.exists(f'{out}/{t:06d}.npz'): jobs.append((p, f'{out}/{t:06d}.npz'))
    with ProcessPoolExecutor(int(os.environ.get('J', 4))) as ex:
        ok = sum(ex.map(one, jobs, chunksize=2))
    print(ok, 'of', len(jobs), 'songs')
