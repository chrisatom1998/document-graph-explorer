"""Stem-separation and Hub-embedding features for the full-mix instrument heads, on a Hugging Face Jobs GPU.

Experiment only: answers whether splitting a song into stems (Demucs htdemucs) or adding MERT-v1-95M music embeddings
gives the full-mix heads (src/audio/fullMixHeads.ts, PR #134) better evidence for the tags that still miss 70/70 on the
DJ clip rounds (bass, organ, trumpet). Nothing here ships in the app.

Clips: OpenMIC-2018 split01_train minus every benchmark artist (scripts/full-mix-heads/openmic-train.py, the same rule
the shipped heads were trained under), plus the DJ clip round 1 and round 2 judge clips (judge only, never fitted on).
Judge clips go first; train clips follow in a fixed random order until DEADLINE_MIN, so a partial run is unbiased.

Per clip and per source (mix, Demucs bass / other / vocals stems, and a 150 Hz low-pass of the mix as a no-model
baseline for the bass stem): the 512-d CLAP audio embedding (laion/larger_clap_music_and_speech, the app's CLAP), and
the 527 AudioSet logits of AST (MIT/ast-finetuned-audioset-10-10-0.4593, the app's AST). Plus each stem's RMS relative
to the mix, and MERT-v1-95M mean-pooled hidden states (13 x 768) of the mix. Models run in fp32 PyTorch, not the app's
q8 ONNX, so the baseline here is a same-pipeline mix-only head, not the shipped one.

Writes chunked .npz files to the private dataset $HF_REPO under $OUT_DIR/ as they fill.
"""
import io, json, os, random, subprocess, sys, tarfile, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import torch, torchaudio

T0 = time.time()
DEADLINE = float(os.environ.get('DEADLINE_MIN', '100')) * 60
SMOKE = os.environ.get('SMOKE')   # SMOKE=<dir of audio files>: run the models on those files locally, upload nothing
REPO, OUT = os.environ.get('HF_REPO', ''), os.environ.get('OUT_DIR', 'stems-v1')
SRC = os.environ.get('SRC', '/src')
CHUNK, BATCH, SR, LEN = 2000, 16, 44100, 10
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
log = lambda *a: print(f'[{(time.time() - T0) / 60:6.1f} min]', *a, flush=True)

from huggingface_hub import HfApi
api = HfApi()

def openmic_clips():
    api.create_repo(REPO, repo_type='dataset', private=True, exist_ok=True)
    tgz = '/work/openmic.tgz'
    subprocess.run(['python3', f'{SRC}/scripts/full-mix-heads/openmic-train.py', tgz, '/work/audio', '/work/train-labels.json'], check=True)
    judge = {}
    for name, path in [('r1', 'docs/evaluations/dj-clips-2026-10-06/openmic-manifest.json'),
                       ('r2', 'docs/evaluations/dj-clips-round2-2026-10-06/openmic-manifest.json')]:
        for it in json.load(open(f'{SRC}/{path}'))['items']: judge[f"{it['sampleKey']}.ogg"] = f'{name}:{it["id"]}'
    want = set(judge)
    with tarfile.open(tgz, 'r|gz') as stream:
        for m in stream:
            n = os.path.basename(m.name)
            if m.isfile() and '/audio/' in f'/{m.name}' and not n.startswith('._') and n in want:
                open(f'/work/audio/{n}', 'wb').write(stream.extractfile(m).read()); want.discard(n)
    assert not want, f'{len(want)} judge clips missing'
    os.remove(tgz)
    train = [it['id'] for it in json.load(open('/work/train-labels.json'))['items']]
    random.Random('dge-hub-stems-2026-10-06').shuffle(train)
    clips = [(judge[k], f'/work/audio/{k}') for k in sorted(judge)] + [(f'train:{k}', f'/work/audio/{k}.ogg') for k in train]
    api.upload_file(path_or_fileobj='/work/train-labels.json', path_in_repo=f'{OUT}/train-labels.json', repo_id=REPO, repo_type='dataset')
    log(f'{len(judge)} judge + {len(train)} train clips')
    return judge, clips

judge, clips = ({}, [(f'smoke:{n}', os.path.join(SMOKE, n)) for n in sorted(os.listdir(SMOKE))]) if SMOKE else openmic_clips()

# ---- models ------------------------------------------------------------------------------------------------------
from demucs.pretrained import get_model
from demucs.apply import apply_model
from transformers import ClapModel, ClapProcessor, ASTForAudioClassification, ASTFeatureExtractor, AutoModel, Wav2Vec2FeatureExtractor
demucs = get_model('htdemucs').to(dev).eval()
assert demucs.sources == ['drums', 'bass', 'other', 'vocals'], demucs.sources
clap = ClapModel.from_pretrained('laion/larger_clap_music_and_speech').to(dev).eval()
clap_fe = ClapProcessor.from_pretrained('laion/larger_clap_music_and_speech')
ast = ASTForAudioClassification.from_pretrained('MIT/ast-finetuned-audioset-10-10-0.4593').to(dev).eval()
ast_fe = ASTFeatureExtractor.from_pretrained('MIT/ast-finetuned-audioset-10-10-0.4593')
mert = AutoModel.from_pretrained('m-a-p/MERT-v1-95M', trust_remote_code=True).to(dev).eval()
mert_fe = Wav2Vec2FeatureExtractor.from_pretrained('m-a-p/MERT-v1-95M', trust_remote_code=True)
SOURCES = ['mix', 'bass', 'other', 'vocals', 'low']
log('models loaded on', torch.cuda.get_device_name() if dev == 'cuda' else 'cpu')

def decode(path):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).T[:, :SR * LEN]
    return np.pad(x, ((0, 0), (0, SR * LEN - x.shape[1])))

@torch.no_grad()
def features(wav):   # wav: [B, 2, T] at 44.1 kHz on the GPU
    ref = wav.mean(1)
    mean, std = ref.mean(1)[:, None, None], ref.std(1)[:, None, None] + 1e-8
    stems = apply_model(demucs, (wav - mean) / std, shifts=0, split=True, overlap=0.25, progress=False) * std[:, None] + mean[:, None]
    mono = {'mix': wav.mean(1), 'bass': stems[:, 1].mean(1), 'other': stems[:, 2].mean(1), 'vocals': stems[:, 3].mean(1)}
    mono['low'] = torchaudio.functional.lowpass_biquad(torchaudio.functional.lowpass_biquad(mono['mix'], SR, 150.0), SR, 150.0)
    rms = lambda x: x.pow(2).mean(-1).sqrt()
    out = {'energy': torch.stack([rms(stems[:, i].mean(1)) for i in range(4)], 1) / (rms(mono['mix'])[:, None] + 1e-8)}
    for s in SOURCES:
        x48 = torchaudio.functional.resample(mono[s], SR, 48000).cpu().numpy()
        x16 = torchaudio.functional.resample(mono[s], SR, 16000).cpu().numpy()
        ci = clap_fe(audios=list(x48), sampling_rate=48000, return_tensors='pt').to(dev)
        out[f'clap_{s}'] = clap.get_audio_features(**ci)
        ai = ast_fe(list(x16), sampling_rate=16000, return_tensors='pt').to(dev)
        out[f'ast_{s}'] = ast(**ai).logits
    x24 = torchaudio.functional.resample(mono['mix'], SR, 24000).cpu().numpy()
    mi = mert_fe(list(x24), sampling_rate=24000, return_tensors='pt').to(dev)
    hs = mert(**mi, output_hidden_states=True).hidden_states
    out['mert_mix'] = torch.stack([h.mean(1) for h in hs], 1).half()
    return {k: v.float().cpu().numpy() if k != 'mert_mix' else v.cpu().numpy() for k, v in out.items()}

# ---- run -----------------------------------------------------------------------------------------------------------
pool = ThreadPoolExecutor(8)
buf, ids, chunk, done = {}, [], 0, 0
def flush():
    global buf, ids, chunk
    if not ids: return
    path = f"{os.environ.get('WORK', '/work')}/chunk-{chunk:03d}.npz"
    np.savez(path, ids=np.array(ids), **{k: np.concatenate(v) for k, v in buf.items()})
    if SMOKE: log({k: v.shape for k, v in np.load(path).items()}); return
    api.upload_file(path_or_fileobj=path, path_in_repo=f'{OUT}/chunk-{chunk:03d}.npz', repo_id=REPO, repo_type='dataset')
    os.remove(path); log(f'uploaded chunk {chunk} ({len(ids)} clips)')
    buf, ids, chunk = {}, [], chunk + 1

batches = [clips[i:i + BATCH] for i in range(0, len(clips), BATCH)]
pending = pool.submit(lambda b: [decode(p) for _, p in b], batches[0])
for bi, batch in enumerate(batches):
    audio = pending.result()
    if bi + 1 < len(batches): pending = pool.submit(lambda b: list(pool.map(lambda c: decode(c[1]), b)), batches[bi + 1])
    f = features(torch.from_numpy(np.stack(audio)).to(dev))
    for k, v in f.items(): buf.setdefault(k, []).append(v)
    ids += [i for i, _ in batch]; done += len(batch)
    if done % 400 < BATCH: log(f'{done}/{len(clips)} clips, {done / (time.time() - T0):.1f}/s overall')
    if len(ids) >= CHUNK: flush()
    if time.time() - T0 > DEADLINE and done >= len(judge): log('deadline reached'); break
flush()
log(f'finished: {done} clips')
