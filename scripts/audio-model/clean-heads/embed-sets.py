"""CLAP windows for fresh board test sets, in the container only (test audio never leaves).
Same prep as fsd50k-clap.py: 48 kHz mono, every whole 10 s window (short clip = one repeat-padded window).
Usage: python3 -I embed-sets.py <set.csv> <out.npz>"""
import csv, sys, numpy as np, torch, soundfile as sf, soxr
from transformers import ClapModel, ClapFeatureExtractor
lab, out = sys.argv[1:3]
torch.set_num_threads(4)
fe = ClapFeatureExtractor.from_pretrained('laion/larger_clap_music_and_speech')
m = ClapModel.from_pretrained('laion/larger_clap_music_and_speech').eval()
N = 480000
ids, embs, buf = [], [], []
def flush():
    with torch.no_grad():
        embs.append(m.get_audio_features(input_features=torch.from_numpy(np.stack(buf))).numpy().astype(np.float16)); buf.clear()
rows = list(csv.DictReader(open(lab)))
for n, r in enumerate(rows):
    try:
        x, sr = sf.read(r['path'], dtype='float32', always_2d=True)
    except Exception as e:
        print('fail', r['id'], e, flush=True); continue
    x = x.mean(1)
    if len(x) < 64: continue
    x = soxr.resample(x, sr, 48000) if sr != 48000 else x
    for j in range(max(1, len(x) // N)):
        s = x[j * N:(j + 1) * N]
        if len(s) < N: s = np.tile(s, int(np.ceil(N / len(s))))[:N]
        buf.append(fe(s, sampling_rate=48000, return_tensors='np', padding='repeatpad', truncation='rand_trunc')['input_features'][0])
        ids.append(r['id'])
        if len(buf) == 32: flush()
    if n % 500 == 0: print(n, len(rows), flush=True)
if buf: flush()
np.savez(out, id=np.array(ids), clap=np.concatenate(embs))
print('done', len(ids), flush=True)
