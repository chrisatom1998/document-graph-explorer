"""Turns Slakh2100 stems into instrument training clips. Every stem is one instrument rendered
from MIDI, and its General MIDI program says exactly which instrument it is. Slakh reuses the
same sound presets across songs, so the preset is the split key: a model is tested only on
presets it never trained on.
Usage:
  slakh-manifest.py pick <metadata root> <out manifest.json> [cap per label]
  slakh-manifest.py cut <manifest.json> <stems root> <clip dir>   (loudest 10 s of each stem)"""
import json, sys, glob, os, random, re, collections, subprocess

# General MIDI programs (0-indexed, as Slakh stores them) -> catalog source labels.
def gm_label(p):
    if p <= 3: return 'piano'
    if p in (4, 5): return 'electric piano'
    if p in (9, 11, 12, 13): return 'mallet instrument'
    if 16 <= p <= 20: return 'organ'
    if p in (24, 25): return 'acoustic guitar'
    if 26 <= p <= 30: return 'electric guitar'
    if 32 <= p <= 37: return 'bass guitar'
    if 40 <= p <= 44 or p in (48, 49): return 'strings'
    if p == 56: return 'trumpet'
    if p == 57: return 'trombone'
    if 64 <= p <= 67: return 'saxophone'
    if p == 71: return 'clarinet'
    if p in (72, 73): return 'flute'
    if 80 <= p <= 95: return 'synthesizer'
    return None

def pick(meta_root, out, cap):
    rows = collections.defaultdict(list)
    for f in glob.glob(f'{meta_root}/**/metadata.yaml', recursive=True):
        text = open(f).read(); track = os.path.dirname(os.path.relpath(f, meta_root))
        for sid, body in re.findall(r'\n  (S\d+):\n((?:    .*\n?)+)', text):
            kv = dict(re.findall(r'    (\w+): (.*)', body))
            if kv.get('audio_rendered') != 'true': continue
            label = 'drums' if kv.get('is_drum') == 'true' else gm_label(int(kv.get('program_num', -1)))
            if not label: continue
            rows[label].append({'id': f'slakh:{track}/{sid}', 'member': f'{track}/stems/{sid}.flac',
                                'labels': [label], 'group': f"slakh:{kv.get('plugin_name', 'unknown')}"})
    random.seed(20261004); clips = []
    for label, items in sorted(rows.items()):
        # Spread the cap across presets so no single preset defines the instrument.
        random.shuffle(items); per = collections.defaultdict(list)
        for it in items: per[it['group']].append(it)
        chosen, i = [], 0
        while len(chosen) < cap and any(i < len(v) for v in per.values()):
            for v in per.values():
                if i < len(v) and len(chosen) < cap: chosen.append(v[i])
            i += 1
        clips += chosen
        print(f'  {label:<18}{len(items):>6} stems  {len(chosen):>4} chosen  from {len({c["group"] for c in chosen})} presets')
    json.dump({'kind': 'slakh-stems-v1', 'clips': clips}, open(out, 'w'))

def cut(manifest, stems_root, clip_dir):
    """Writes the loudest 10 s of each stem (Slakh stems are silent wherever the part rests)."""
    import numpy as np
    from concurrent.futures import ThreadPoolExecutor
    m = json.load(open(manifest)); os.makedirs(clip_dir, exist_ok=True)
    def one(c):
        src = f"{stems_root}/{c['member']}"; dst = f"{clip_dir}/{c['id'].split(':')[1].replace('/', '_')}.wav"
        if not os.path.exists(dst):
            if not os.path.exists(src): return None
            raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'],
                                 capture_output=True).stdout
            x = np.frombuffer(raw, np.float32)
            if len(x) < 8000 * 3: return None
            e = np.convolve(x ** 2, np.ones(8000), 'valid')[::8000]          # energy per 1 s step
            w = np.convolve(e, np.ones(10), 'valid') if len(e) >= 10 else e[:1]
            start = int(np.argmax(w))
            if w[start] < 1e-4: return None                                    # silent stem
            subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-ss', str(start), '-t', '10', '-i', src, dst], check=True)
        return {**c, 'path': os.path.abspath(dst)}
    with ThreadPoolExecutor(8) as pool: kept = [c for c in pool.map(one, m['clips']) if c]
    m['clips'] = kept; json.dump(m, open(manifest, 'w')); print(f'{len(kept)} clips cut')

if __name__ == '__main__':
    if sys.argv[1] == 'pick': pick(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 400)
    else: cut(*sys.argv[2:5])
