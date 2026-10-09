"""Generates DJ-effect TRAINING clips with Stable Audio Open Small (text to audio, 341M parameters, runs on a CPU).

Weights: stabilityai/stable-audio-open-small (gated on Hugging Face; Stability AI Community License: free for
individuals and organisations under $1M annual revenue, generated audio belongs to us). The weights never ship in the
app; only CLAP heads trained partly on these clips do. Each prompt varies the effect's character, length and context.
Clips get the group "sao:<label>:<k mod 25>" and split 'train', so they never reach the held-out test; train.py picks
them per label only where they help on the REAL training clips. Deterministic seeds. Mono 48 kHz, at most 10 s.
Usage: sao.py <out dir> [shard shards]   env: PER_EFFECT (300, split across shards), HF_TOKEN"""
import json, os, sys, random, time, wave
import numpy as np
import torch, torchaudio
from einops import rearrange
from stable_audio_tools import get_pretrained_model
from stable_audio_tools.inference.generation import generate_diffusion_cond

OUT = sys.argv[1]
SHARD, SHARDS = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 1)
PER_EFFECT = int(os.environ.get('PER_EFFECT', 300)) // SHARDS
os.makedirs(OUT, exist_ok=True)

STYLE = ['', 'EDM ', 'cinematic ', 'hip hop ', 'techno ', 'dubstep ', 'trap ', 'house music ', 'drum and bass ', 'lo-fi ']
FX = {
    'impact': ['{s}impact hit, deep boom with long reverb tail', 'heavy {s}impact, punchy low end hit', 'trailer hit, metallic {s}impact',
               '{s}downbeat impact, sub boom and crash', 'distorted {s}impact sound effect'],
    'whoosh': ['fast {s}whoosh transition', 'airy swoosh passing by', 'short whoosh sound effect, wind sweep', '{s}whoosh, swish transition fx'],
    'riser': ['{s}riser, rising white noise and synth build-up', 'uplifter sweep building tension, {s}transition', 'pitch rising synth riser before the drop',
              '{s}build up riser with snare roll'],
    'downlifter': ['{s}downlifter, falling noise sweep after the drop', 'descending synth sweep, downlifter fx'],
    'laser': ['{s}laser zap sound effect', 'retro sci-fi laser shot', 'pew pew laser blasts', '{s}laser synth fx, fast pitch drop'],
    'siren': ['dub siren with echo', 'police siren wailing', '{s}siren synth effect', 'reggae dub siren sound'],
    'air horn': ['dj air horn blasts', 'reggae air horn, three short blasts and a long one', 'stadium air horn sound', '{s}air horn sample'],
    'reverse cymbal': ['reverse cymbal swell', 'reversed crash cymbal build into a hit', 'backwards cymbal transition'],
    'sub drop': ['808 sub drop, deep falling bass boom', '{s}sub drop, low frequency pitch drop'],
    'vinyl scratch': ['dj vinyl scratching on a turntable', 'hip hop record scratch', 'turntablist scratches over a beat'],
}


def write(path, y, rate):
    y = np.clip(y, -1, 1); pcm = (y * 32767).astype('<i2')
    with wave.open(path, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm.tobytes())


torch.set_num_threads(os.cpu_count() or 4)
model, config = get_pretrained_model('stabilityai/stable-audio-open-small')
SR, SIZE = config['sample_rate'], config['sample_size']
model = model.eval()
out = []
for label, prompts in FX.items():
    r = random.Random(f'dj-effects-sao|{label}|{SHARD}'); t0 = time.time()
    for k in range(PER_EFFECT):
        rid = f"sao:{label.replace(' ', '-')}:{SHARD}-{k}"; path = os.path.join(OUT, rid.replace(':', '_') + '.wav')
        if not os.path.exists(path):
            prompt = r.choice(prompts).format(s=r.choice(STYLE)); secs = r.uniform(1.5, 10)
            with torch.no_grad():
                audio = generate_diffusion_cond(model, steps=8, conditioning=[{'prompt': prompt, 'seconds_total': secs}],
                                                sample_size=SIZE, sampler_type='pingpong', device='cpu', seed=r.randrange(1 << 31))
            y = rearrange(audio, 'b d n -> d (b n)').float().mean(0, keepdim=True)
            y = torchaudio.functional.resample(y, SR, 48000)[0, :int(48000 * min(secs, 10))].numpy()
            y = y / (np.abs(y).max() + 1e-9) * r.uniform(.3, .95)
            write(path, y, 48000)
        out.append({'id': rid, 'path': path, 'labels': [label], 'group': f'sao:{label}:{(SHARD * PER_EFFECT + k) % 25}',
                    'split': 'train', 'kind': 'render', 'source': 'stable-audio-open-small'})
    print(f'{label:<16}{PER_EFFECT:>5} clips  {(time.time() - t0) / max(1, PER_EFFECT):.1f} s per clip', flush=True)
json.dump({'kind': 'dj-effects-sao-v1', 'clips': out}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=0)
