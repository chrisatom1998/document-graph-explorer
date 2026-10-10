import csv, glob, io, os, sys, tarfile, collections
import numpy as np, soundfile as sf
from scipy.signal import stft
out = sys.argv[1]; res = collections.defaultdict(list)
for m in glob.glob(f'{out}/*/manifest.csv'):
    part = os.path.dirname(m); rows = list(csv.DictReader(open(m))); tars = {}
    by = collections.defaultdict(dict)
    for r in rows: by[r['pair_id']][r['role']] = r
    for pid, p in by.items():
        clips = {}
        for role, r in p.items():
            tn, mem = r['file'].split('/', 1)
            if tn not in tars: tars[tn] = tarfile.open(os.path.join(part, tn))
            clips[role], sr = sf.read(io.BytesIO(tars[tn].extractfile(mem).read()))
        d, w = clips['dry'], clips['wet']; 
        if not (len(d) == len(w) and sr == 16000 and len(d) <= 160000): print("BAD", p["wet"]["effect"], len(d), len(w), sr, p["wet"]["effect_settings"]); continue
        S = lambda x: np.log(np.abs(stft(x, 16000, nperseg=512)[2]) + 1e-4)
        sd, sw = S(d), S(w)
        res[p['wet']['effect']].append((np.mean(np.abs(sd - sw)), np.mean(np.abs(sd.mean(1) - sw.mean(1))), len(d) / 16000, 20*np.log10(np.sqrt(np.mean(w**2))/np.sqrt(np.mean(d**2)+1e-12)+1e-12)))
for t, v in sorted(res.items()):
    a = np.array(v); print(f'{t:16s} n={len(v):4d} frameL1 p10={np.percentile(a[:,0],10):.2f} med={np.median(a[:,0]):.2f}  spectrumL1 p10={np.percentile(a[:,1],10):.2f} med={np.median(a[:,1]):.2f}  sec med={np.median(a[:,2]):.1f} max={a[:,2].max():.1f} dB wet-dry med={np.median(a[:,3]):.2f}')
