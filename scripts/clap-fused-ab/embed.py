"""CLAP audio fingerprints + prompt text vectors for the clap-htsat-fused A/B (judge-only).

Both encoders run here through the same PyTorch path (fp32, each model's own preprocessor), mono 48 kHz, first 10 s of
each clip (or the whole clip when shorter, which the preprocessor repeat-pads to 10 s, like the app's clapRepeat).
The app itself runs a q8 ONNX export of the current model; fp32 here keeps the comparison encoder-against-encoder.
Usage: embed.py <model id> <clips.json {clips:[{id,path}]}> <out.jsonl> [shard shards]
       embed.py <model id> --prompts <prompts.json [{label,prompt}]> <out.json>"""
import json, os, subprocess, sys, time
import numpy as np, torch
from transformers import ClapModel, ClapProcessor

MODEL = sys.argv[1]
torch.set_num_threads(int(os.environ.get('THREADS', '0')) or torch.get_num_threads())
model = ClapModel.from_pretrained(MODEL).eval(); proc = ClapProcessor.from_pretrained(MODEL)
vec = lambda o: (o if torch.is_tensor(o) else o.pooler_output)[0].numpy().astype(float)

if sys.argv[2] == '--prompts':
    prompts = json.load(open(sys.argv[3])); out = []
    with torch.no_grad():
        for p in prompts:
            t = proc.tokenizer([p['prompt']], padding=True, return_tensors='pt')
            out.append({**p, 'vector': [round(v, 6) for v in vec(model.get_text_features(**t)).tolist()]})
    json.dump(out, open(sys.argv[4], 'w')); sys.exit(0)

CLIPS, OUT = sys.argv[2:4]; SHARD, SHARDS = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (0, 1)
clips = [c for k, c in enumerate(json.load(open(CLIPS))['clips']) if k % SHARDS == SHARD]
done = {json.loads(l)['id'] for l in open(OUT)} if os.path.exists(OUT) else set()
todo = [c for c in clips if c['id'] not in done]
print(f'{MODEL} shard {SHARD}/{SHARDS}: {len(clips)} clips, {len(todo)} to go', flush=True)

def decode(path):
    r = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', path, '-t', '10', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy()

t0, n, bad = time.time(), 0, 0
with open(OUT, 'a') as f, torch.no_grad():
    for c in todo:
        try:
            x = decode(c['path'])
            if len(x) < 4800 or float((x * x).mean()) < 1e-8: bad += 1; continue  # the app skips near-silent input
            inp = proc.feature_extractor(x, sampling_rate=48000, return_tensors='pt')
            e = vec(model.get_audio_features(**inp))
            f.write(json.dumps({'id': c['id'], 'embedding': [round(v, 6) for v in e.tolist()]}) + '\n'); n += 1
        except Exception as ex:
            bad += 1; print('skip', c['id'], str(ex)[:100], flush=True)
        if (n + bad) % 200 == 0: print(f'  {n + bad}/{len(todo)} {n / (time.time() - t0):.1f}/s', flush=True)
print(f'done: {n} embedded, {bad} skipped in {(time.time() - t0) / 60:.1f} min', flush=True)
