"""Training and evaluation audio for DGE's own instrument tagger (scripts/audio-model/train.py).

Usage: python3 scripts/audio-model/prepare.py <openmic-2018-v1.0.0.tgz> <out-dir> [<eval-manifest.json>...]

Training clips are OpenMIC-2018's split01_train partition minus every FMA artist used by a DGE benchmark (the 900-clip
mixed-music set, DJ clip rounds 1 and 2), the same rule as scripts/full-mix-heads/openmic-train.py. Every benchmark draws
from split01_test, so no benchmark clip is trained on; dropping their artists keeps unseen artists unseen.

Writes to <out-dir>:
  train.json        {items: [{id, artist, labels: {class: relevance}}]}, relevance >= 0.5 present, < 0.5 absent
  train-mel.npy     float16 [N, 128, 1000]: each clip as 32 kHz mono, padded or cut to 10 s, as the tagger's log-mel
                    input (EfficientAT front end in eval mode)
  eval-<name>.json / eval-<name>.npy   eval manifest clips (test split only) as int16 32 kHz waveforms [N, 320000], so
                    the exported ONNX model is scored end to end from audio
"""
import ast, csv, io, json, os, subprocess, sys, tarfile
from concurrent.futures import ThreadPoolExecutor
import warnings
import numpy as np
warnings.filterwarnings('ignore')
import torch
sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
from models.preprocess import AugmentMelSTFT  # noqa: E402
torch.set_num_threads(1)
MEL = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
def to_mel(x):
    with torch.no_grad(): return MEL(torch.from_numpy(x.astype(np.float32)[None] / 32768))[0, :, :1000].numpy().astype(np.float16)

SR, N = 32000, 320000
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
BENCHMARKS = [os.path.join(ROOT, 'docs', 'evaluations', *p) for p in
              [('mixed-music-2026-10-05', 'manifest.json'), ('dj-clips-2026-10-06', 'openmic-manifest.json')]]
ROUND2 = os.path.join(os.path.dirname(__file__), 'round2-artists.json')  # artists of PR #119's round 2 clips

tgz, out, *eval_manifests = sys.argv[1:]
os.makedirs(out, exist_ok=True)
used_artists = {it['groups']['artist'].split(':', 1)[1] for p in BENCHMARKS for it in json.load(open(p))['items']}
used_artists |= set(json.load(open(ROUND2)))

tf = tarfile.open(tgz)
members = {m.name: m for m in tf.getmembers() if m.isfile()}
def read(suffix):
    found = [m for n, m in members.items() if n.endswith('/' + suffix) or n == suffix]
    if len(found) != 1: sys.exit(f'expected one archive member ending {suffix}, found {len(found)}')
    return tf.extractfile(found[0]).read().decode('utf-8-sig')
train = set(read('partitions/split01_train.csv').split())
test = set(read('partitions/split01_test.csv').split())
assert not train & test
meta = {r['sample_key']: r for r in csv.DictReader(io.StringIO(read('openmic-2018-metadata.csv')))}
labels = {}
for r in csv.DictReader(io.StringIO(read('openmic-2018-aggregated-labels.csv'))):
    labels.setdefault(r['sample_key'], {})[r['instrument']] = float(r['relevance'])

sets = {'train': [{'id': k, 'artist': meta[k]['artist_id'], 'labels': labels[k]}
                  for k in sorted(train) if k in meta and k in labels and meta[k]['artist_id'] not in used_artists]}
for path in eval_manifests:
    name = os.path.splitext(os.path.basename(path))[0]
    items = json.load(open(path))['items']
    keys = [it['sampleKey'] for it in items]
    assert all(k in test for k in keys), f'{path}: eval clips must come from split01_test'
    sets[name] = [{'id': it['id'], 'sampleKey': it['sampleKey'], 'artist': it['groups']['artist'],
                   'genres': it.get('genres', []), 'djTier': it.get('djTier'),
                   'labels': {r['label']: r['state'] for r in it['reviews'] if r['dimension'] == 'source'}} for it in items]
key_of = lambda it: it.get('sampleKey', it['id'])
assert not {key_of(i) for i in sets['train']} & {key_of(i) for n, s in sets.items() if n != 'train' for i in s}

wanted = {}
for name, items in sets.items():
    for row, it in enumerate(items): wanted.setdefault(f'{key_of(it)}.ogg', []).append((name, row))
arrays = {name: np.lib.format.open_memmap(os.path.join(out, 'train-mel.npy' if name == 'train' else f'eval-{name}.npy'), mode='w+',
                                          dtype=np.float16 if name == 'train' else np.int16,
                                          shape=(len(items), 128, 1000) if name == 'train' else (len(items), N)) for name, items in sets.items()}
tf.close()

def decode(data):
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 's16le', 'pipe:1'],
                         input=data, capture_output=True, check=True).stdout
    x = np.frombuffer(pcm, dtype=np.int16)[:N]
    x = np.pad(x, (0, N - len(x)))
    return x, to_mel(x)

pending, done = [], 0
with ThreadPoolExecutor(os.cpu_count()) as pool, tarfile.open(tgz, 'r|gz') as stream:
    for m in stream:
        name = os.path.basename(m.name)
        if m.isfile() and '/audio/' in f'/{m.name}' and not name.startswith('._') and name in wanted:
            pending.append((wanted.pop(name), pool.submit(decode, stream.extractfile(m).read())))
        while pending and (pending[0][1].done() or len(pending) > 64):
            slots, fut = pending.pop(0); x, m = fut.result()
            for set_name, row in slots: arrays[set_name][row] = m if set_name == 'train' else x
            done += 1
            if done % 2000 == 0: print(f'{done} clips decoded', flush=True)
    for slots, fut in pending:
        x, m = fut.result()
        for set_name, row in slots: arrays[set_name][row] = m if set_name == 'train' else x
if wanted: sys.exit(f'{len(wanted)} clips missing from the archive, e.g. {sorted(wanted)[:3]}')
for name, arr in arrays.items(): arr.flush()
for name, items in sets.items():
    json.dump({'items': items}, open(os.path.join(out, f'{name if name == "train" else "eval-" + name}.json'), 'w'))
print({name: len(items) for name, items in sets.items()}, f'{len({i["artist"] for i in sets["train"]})} train artists')
