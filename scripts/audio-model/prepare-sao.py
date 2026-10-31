"""Stable Audio Open Small effect clips (private dataset <user>/dge-effects-sao, made in the "Other AI models" thread) for
the tagger's app-named head, with held-out prompt groups as a test set.

Usage: python3 scripts/audio-model/prepare-sao.py <out-dir> [--repo cmjatom/dge-effects-sao] [--limit N]
  -> sao-mel.npy + sao.json             training clips (renders: generated audio, not recordings)
  -> eval-sao.npy + eval-sao.json       HELD-OUT prompt groups (int16 32 kHz, evaluate.py format), never trained, tuned or calibrated on

sao/manifest.json lists 3,000 clips (300 each of impact, whoosh, riser, downlifter, laser, siren, air horn, reverse cymbal,
sub drop, vinyl scratch) with a prompt group 'sao:<label>:<k>'. One group in five (by hash) is held out, whole, so a
test clip never shares a prompt with a training clip. A clip's own labels are present; the other nine are weak absences
in training (a generated riser may carry an impact) and absences in the test set. Air horn and sub drop have no real
test audio yet, so their test verdicts here come from generated clips only.
"""
import argparse, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import CAT  # noqa: E402

h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--repo', default='cmjatom/dge-effects-sao'); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--local', help='already-downloaded copy (tests)')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    import numpy as np, importlib.util
    from huggingface_hub import snapshot_download
    d = args.local or snapshot_download(args.repo, repo_type='dataset', allow_patterns=['sao/*'], local_dir=os.path.join(args.out, 'sao-download'), max_workers=16)
    clips = [c for c in json.load(open(os.path.join(d, 'sao/manifest.json')))['clips'] if c.get('split', 'train') == 'train']
    if args.limit: clips = clips[::max(1, len(clips) // args.limit)]
    taught = sorted({l for c in clips for l in c['labels']} & set(CAT))
    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prepare-extra.py'))
    pe = importlib.util.module_from_spec(spec); spec.loader.exec_module(pe)
    w = pe.Writer(args.out, 'sao', 1000); items, wavs = [], []
    for c in clips:
        x = pe.decode(open(os.path.join(d, c['path']), 'rb').read())
        if x is None: continue
        held = int(h('dge-sao-test', c['group'])[:8], 16) % 5 == 0
        if held:
            wavs.append((x * 32767).astype(np.int16))
            items.append({'id': c['id'], 'artist': c['group'], 'labels': {f'cat:{l}': 'present' if l in c['labels'] else 'absent' for l in taught}})
        else:
            lab = {f'cat:{l}': float(l in c['labels']) for l in taught}
            w.add({'id': c['id'], 'artist': c['group'], 'val': int(h('dge-sao-val', c['group'])[:8], 16) % 8 == 0, 'labels': lab,
                   'weakAbsent': [f'cat:{l}' for l in taught if l not in c['labels']], 'source': 'stable-audio-open-small'}, x)
    np.save(os.path.join(args.out, 'eval-sao.npy'), np.stack(wavs) if wavs else np.zeros((0, 320000), np.int16))
    json.dump({'source': f'{args.repo} held-out prompt groups (generated clips; test only)', 'items': items}, open(os.path.join(args.out, 'eval-sao.json'), 'w'))
    print(f'eval-sao: {len(items)} held-out generated clips', flush=True)
    w.close(f'Stable Audio Open Small clips ({args.repo}, private; generated renders), held-out prompt groups excluded')
    import shutil; shutil.rmtree(os.path.join(args.out, 'sao-download'), ignore_errors=True)

if __name__ == '__main__':
    main()
