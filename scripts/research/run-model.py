"""Frozen-model research adapter. Never trains; never downloads weights implicitly.

python scripts/research/run-model.py manifest.json output.json --model peace --checkpoint /local/export --revision SHA
python scripts/research/run-model.py manifest.json output.json --model tp-clap --checkpoint /local/tp-clap.pt --revision SHA
Install the author's pinned repository and dependencies in a separate environment first.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import time

p = argparse.ArgumentParser()
p.add_argument('manifest', type=Path)
p.add_argument('output', type=Path)
p.add_argument('--model', choices=['peace', 'tp-clap'], required=True)
p.add_argument('--checkpoint', type=Path, required=True)
p.add_argument('--revision', required=True, help='Pinned upstream code/checkpoint identity')
p.add_argument('--threads', type=int, default=4)
p.add_argument('--prompt', default='Which musical instruments are audible?')
p.add_argument('--audio-backbone', help='Local CED model directory for TP-CLAP')
p.add_argument('--text-backbone', help='Local BERT model directory for TP-CLAP')
args = p.parse_args()
if args.output.exists():
    raise SystemExit('Refusing to overwrite a run')
args.output.parent.mkdir(parents=True, exist_ok=True)
if not args.checkpoint.exists():
    raise SystemExit('Missing local checkpoint. Download and verify it explicitly before inference.')
manifest = json.loads(args.manifest.read_text())
if manifest.get('version') != 'dge-research-v1':
    raise SystemExit('Invalid manifest')
# Enforce these before importing model libraries, even in an online parent shell.
os.environ['OMP_NUM_THREADS'] = str(args.threads)
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
rows = []
report = {'model': args.model, 'revision': args.revision, 'prompt': args.prompt,
          'checkpoint': args.checkpoint.name,
          'manifestSha256': hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
          'platform': platform.platform(), 'processor': platform.processor(), 'requestedOmpThreads': args.threads,
          'versions': {name: importlib.metadata.version(name) for name in
                       ['numpy', 'torch', 'transformers', 'jax', 'flax', 'peace', 'tp-clap']},
          'threadingNote': 'PyTorch set_num_threads is applied. OMP_NUM_THREADS does not bound all JAX/XLA threads.',
          'coldDefinition': 'First clip in this process only; later unseen input shapes may still compile.',
          'boundary': 'Local file decode, preprocessing and inference; model loading measured separately. CPU batch size 1. Not browser end-to-end.',
          'rows': rows}
started = time.perf_counter()
if args.model == 'peace':
    import numpy as np
    import jax
    from audiotree import AudioTree
    from peace import PEACE
    model = PEACE.from_pretrained(args.checkpoint, local_files_only=True)
    def infer(path, binding):
        audio = AudioTree.from_file(str(path))
        embedding = np.asarray(jax.block_until_ready(model.encode_audio(audio)))[0].tolist()
        return {'embedding': embedding}
else:
    import numpy as np
    import torch
    from tp_clap.evaluation import ModelProvider
    from tp_clap.encoding import encode_texts, encode_conditioned_and_plain
    torch.set_num_threads(args.threads)
    config = {'model': {}}
    if args.audio_backbone:
        config['model']['audio_encoder'] = args.audio_backbone
    if args.text_backbone:
        config['model']['text_encoder'] = args.text_backbone
    provider = ModelProvider(config, device='cpu')
    model = provider.model_for(str(args.checkpoint))
    def infer(path, binding):
        embedding_started = time.perf_counter()
        with torch.inference_mode():
            conditioned, plain = encode_conditioned_and_plain(model, provider.audio_processor, provider.tokenizer,
                [str(path)], args.prompt, 'cpu', batch_size=1)
            result = {'embedding': plain[0].tolist(), 'queryEmbedding': conditioned[0].tolist(),
                      'embeddingElapsedMs': (time.perf_counter() - embedding_started) * 1000}
            if binding:
                control_started = time.perf_counter()
                text = encode_texts(model, provider.tokenizer, [binding['positive'], binding['negative']], 'cpu', show_progress=False)
                # Standard MASB cosine protocol: unconditioned audio vs caption embeddings.
                # Keep conditioned retrieval separate so audio and silence use the same head.
                scores = (plain @ text.T)[0].tolist()
                silent = np.zeros(160000, dtype=np.float32)
                from tp_clap.encoding import encode_waveforms
                null_audio = encode_waveforms(model, provider.audio_processor, [silent], 'cpu')
                null_scores = (null_audio @ text.T)[0].tolist()
                result['binding'] = {'positive': scores[0], 'negative': scores[1],
                                     'silencePositive': null_scores[0], 'silenceNegative': null_scores[1],
                                     'control': 'unconditioned ten-second silence; not an LLM text-only control'}
                result['bindingControlElapsedMs'] = (time.perf_counter() - control_started) * 1000
            return result
report['loadMs'] = (time.perf_counter() - started) * 1000
for i, clip in enumerate(manifest['clips']):
    start = time.perf_counter()
    try:
        path = (args.manifest.parent / clip['path']).resolve()
        if hashlib.sha256(path.read_bytes()).hexdigest() != clip['sha256']:
            raise ValueError('Audio checksum mismatch')
        result = infer(path, clip.get('binding'))
        rows.append({'id': clip['id'], 'status': 'complete', 'cold': i == 0,
                     'elapsedMs': (time.perf_counter() - start) * 1000, **result})
    except Exception as error:
        rows.append({'id': clip['id'], 'status': 'failed', 'error': str(error),
                     'elapsedMs': (time.perf_counter() - start) * 1000})
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(clip['id'], rows[-1]['status'], flush=True)
if any(r['status'] != 'complete' for r in rows):
    raise SystemExit(1)
