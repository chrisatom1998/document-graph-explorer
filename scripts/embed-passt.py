"""PaSST counterpart of embed-clap.mjs: one 768-number fingerprint per clip, same manifest in,
same JSONL out, so the identical trainers can compare PaSST against CLAP on identical files.
Uses the frozen PaSST backbone (OpenMIC checkpoint) only as a feature extractor; its 20-class
head is ignored. First 10 s, mono 32 kHz, zero-padded - the window the model was trained on.
Usage: embed-passt.py <manifest.json> <out.jsonl> [shard shards]"""
import sys, json, os, io, contextlib, subprocess, time
import numpy as np, torch
from hear21passt.models.passt import get_model
from hear21passt.models.preprocess import AugmentMelSTFT

MANIFEST, OUT = sys.argv[1:3]
SHARD, SHARDS = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (0, 1)
CKPT = 'artifacts/astra90/experiments/passt-openmic-pretrained-v7/openmic-passt-s-f128-10sec-p16-s10-ap.85.pt'
torch.set_num_threads(int(os.environ.get('THREADS', '2')))
dev = 'mps' if torch.backends.mps.is_available() and os.environ.get('DEVICE', 'mps') == 'mps' else 'cpu'
with contextlib.redirect_stdout(io.StringIO()):
    net = get_model(arch='openmic', pretrained=False, n_classes=20, u_patchout=0, s_patchout_t=0, s_patchout_f=0)
state = torch.load(CKPT, map_location='cpu', weights_only=True); net.load_state_dict(state.get('model', state), strict=True)
net.eval().to(dev)
mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=48, timem=192, htk=False,
                     fmin=0, fmax=None, norm=1, fmin_aug_range=10, fmax_aug_range=2000).eval().to(dev)

clips = [c for i, c in enumerate(json.load(open(MANIFEST))['clips']) if i % SHARDS == SHARD]
done = set()
if os.path.exists(OUT):
    for line in open(OUT): done.add(json.loads(line)['id'])
todo = [c for c in clips if c['id'] not in done]
print(f'shard {SHARD}/{SHARDS} on {dev}: {len(clips)} clips, {len(done)} done, {len(todo)} to go', flush=True)
t0 = time.time(); n = skipped = 0
with open(OUT, 'a') as out:
    for c in todo:
        try:
            raw = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '1', '-i', c['path'], '-t', '10',
                                           '-ac', '1', '-ar', '32000', '-f', 'f32le', 'pipe:1'])
            pcm = np.frombuffer(raw, dtype='<f4').copy()
            if len(pcm) < 3200 or float((pcm ** 2).mean()) < 1e-8: skipped += 1; continue
            z = np.pad(pcm[:320000], (0, max(0, 320000 - len(pcm)))).astype('<f4')
            with torch.inference_mode(), contextlib.redirect_stdout(io.StringIO()):
                _, ft = net(mel(torch.from_numpy(z)[None].to(dev)).unsqueeze(1))
            out.write(json.dumps({'id': c['id'], 'embedding': [round(float(v), 6) for v in ft[0].cpu().numpy()]}) + '\n'); n += 1
        except Exception as e:
            skipped += 1
            if skipped <= 3: print(f'  skip {c["id"]}: {str(e)[:80]}', flush=True)
        if (n + skipped) % 200 == 0:
            r = n / (time.time() - t0); print(f'  shard {SHARD}: {n + skipped}/{len(todo)}  {r:.1f}/s', flush=True)
print(f'shard {SHARD} done: {n} embedded, {skipped} skipped, {(time.time() - t0) / 60:.1f} min', flush=True)
