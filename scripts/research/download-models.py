"""Explicit research-only downloads, pinned to immutable upstream revisions.

Requires huggingface_hub. PEACE weights are CC BY-NC 4.0; do not ship them in DGE.
Usage: python scripts/research/download-models.py /local/model-directory
"""
from pathlib import Path
import sys
from huggingface_hub import snapshot_download, hf_hub_download

root = Path(sys.argv[1]).resolve()
models = [
    ('davidbraun/peace', '484fe3cbf4a21226f0989fbbcadb126c59ec34ef', 'peace', ['boxgraph/*']),
    ('mohanli/TP-CLAP', 'b14090f5210715958f5ab7056d3c47f5f61cb582', 'tp-clap', ['tp-clap.pt', 'tp-clap_mtt.pt']),
    ('mispeech/ced-base', 'db3e14a8db4c21b56b165261c39649741a900e7f', 'ced',
     ['*.json', '*.py', 'model.safetensors']),
    ('google-bert/bert-base-uncased', '86b5e0934494bd15c9632b12f734a8a67f723594', 'bert',
     ['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt']),
]
for repo, revision, directory, patterns in models:
    snapshot_download(repo, revision=revision, allow_patterns=patterns, local_dir=root / directory)
# The CED configuration reads AudioSet label names from this independent model.
# Cache this exact revision plus its main pointer for the unmodified upstream loader.
pinned = hf_hub_download('topel/ConvNeXt-Tiny-AT', 'class_labels_indices.csv',
                         revision='e3eaf4c49769f034942da9062d0fee436657560b')
current = hf_hub_download('topel/ConvNeXt-Tiny-AT', 'class_labels_indices.csv')
if Path(pinned).read_bytes() != Path(current).read_bytes():
    raise RuntimeError('Upstream AudioSet metadata changed; refusing an unpinned loader dependency')
