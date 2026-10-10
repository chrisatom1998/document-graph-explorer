"""Versilian Community Sample Library (VCSL, CC0) one-shots for the tagger's app-named head, plus a held-out test set.

Usage: python3 scripts/audio-model/prepare-vcsl.py <out-dir> [--per-folder 40] [--workers 16] [--limit N] [--list]
  -> vcsl-mel.npy + vcsl.json   training notes and hits (one 10 s window each, padded)
  -> eval-vcsl.npy + eval-vcsl.json   HELD-OUT test clips (int16 32 kHz, evaluate.py format): never trained, tuned or calibrated on
  --list prints the plan (no audio).

Source: https://github.com/sgossner/VCSL at a pinned commit (CC0 1.0). Files are read from raw.githubusercontent.com.
Each instrument folder (third path level, e.g. 'Idiophones/Struck Idiophones/Woodblock') maps to catalog labels (FOLDERS).
Every file is one instrument, so its labels are strong; family labels it may or may not count as (percussion, hand
percussion, bell, mallet instrument, tuned percussion, cymbal, drums) stay unlabelled unless the folder names them.

Test split, decided before any training and recorded in eval-vcsl.json: whole folders, never files of a folder on both
sides. One folder (by hash) of every label with two or more folders is held out, plus every
folder in TEST_ONLY (labels with no other test audio yet: woodblock, whistle). A label whose only folders are all held out
trains on other sources (Iowa woodblocks; Freesound whistles).
"""
import argparse, hashlib, json, os, re, subprocess, sys, time, urllib.parse, urllib.request, warnings
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import CAT  # noqa: E402
from labels_extra import EXTRA_CAT  # noqa: E402
CAT = list(CAT) + EXTRA_CAT

REPO, SHA = 'sgossner/VCSL', 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'
RATE = 32000
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
MALLET = ['mallet instrument', 'tuned percussion']
FOLDERS = {
    'Ball Whistle': ['whistle'], 'Train Whistle, Toy': ['whistle'], 'Pipe Organ': ['organ'], 'Renaissance Organ': ['organ'],
    'Harmonica-Hohner-Special20-C': ['harmonica'], 'Harmonica-Hohner-Special20-F': ['harmonica'], 'Harmonica-Hohner-Super64': ['harmonica'],
    'Siren': ['siren'], 'Saxello': ['saxophone'], 'Tenor Saxophone': ['saxophone'], 'Concert Harp': ['harp'], 'Folk Harp': ['harp'],
    'Grand Piano, Kawai': ['piano'], 'Grand Piano, Steinway B': ['piano'], 'Upright Piano, Knight': ['piano'], 'Upright Piano, Yamaha': ['piano'],
    'Clavisynth': ['fm synth', 'synthesizer'], 'FM Piano': ['fm synth', 'synthesizer'], 'Piano 1': ['fm synth', 'synthesizer'],
    'Kalimba, Kenya': ['kalimba', 'tuned percussion'], 'Kalimba, Tanzania': ['kalimba', 'tuned percussion'],
    'Mbira Mavembe (Gandanga), Zimbabwe, Low G': ['kalimba', 'tuned percussion'], 'Mbira dzaVadzimu Nyamaropa, Zimbabwe, Low B': ['kalimba', 'tuned percussion'],
    'Nyunga Nyunga, Mozambique, Low F': ['kalimba', 'tuned percussion'],
    'Agogo Bells': ['percussion hit', 'percussion'], 'Anvil': ['percussion hit', 'percussion', 'metallic'], 'Brake Drum': ['percussion hit', 'percussion', 'metallic'],
    'Balafon': ['mallet instrument', 'tuned percussion', 'xylophone'], 'Cabasa': ['shaker', 'percussion'], 'Shaker, Large': ['shaker', 'percussion'],
    'Shaker, Small': ['shaker', 'percussion'], 'Cajon': ['cajon', 'hand percussion', 'percussion'], 'Claps': ['clap'],
    'Clash Cymbals 1': ['cymbal', 'crash cymbal'], 'Clash Cymbals 2': ['cymbal', 'crash cymbal'], 'Suspended Cymbal 1': ['cymbal'], 'Suspended Cymbal 2': ['cymbal'],
    'Claves': ['clave', 'percussion hit', 'percussion'], 'Cowbells': ['cowbell', 'percussion hit', 'percussion'],
    'Glockenspiel': ['glockenspiel'] + MALLET, 'Tubular Glockenspiel': ['glockenspiel'] + MALLET, 'Marimba': ['marimba'] + MALLET,
    'Vibraphone': ['vibraphone'] + MALLET, 'Xylophone': ['xylophone'] + MALLET,
    'Gong 1': ['gong'], 'Gong 2': ['gong'], 'Hand Bells, Nepalese': ['bell', 'tuned percussion'], 'Hand Chimes': ['bell', 'tuned percussion'],
    'Tubular Bells 1': ['bell'] + MALLET, 'Tubular Bells 2': ['bell'] + MALLET, 'Hi-Hat Cymbal': ['hi-hat', 'cymbal'],
    'Tambourine 1': ['tambourine', 'percussion'], 'Tambourine 2': ['tambourine', 'percussion'], 'Triangles': ['triangle', 'percussion'],
    'Woodblock': ['woodblock', 'percussion hit', 'percussion'], 'Slit Drum': ['hand percussion', 'percussion'],
    'Bongos': ['bongo', 'hand percussion', 'percussion'], 'Conga': ['conga', 'hand percussion', 'percussion'],
    'Darbuka': ['hand percussion', 'percussion'], 'Frame Drum': ['hand percussion', 'percussion'],
    'Snare Drum, Modern 1': ['snare', 'drums'], 'Snare Drum, Modern 2': ['snare', 'drums'], 'Snare Drum, Modern 3': ['snare', 'drums'],
    'Snare Drum, Rope Tension': ['snare', 'drums'], 'Tom 1': ['tom', 'drums'], 'Tom 2': ['tom', 'drums'],
}
TEST_ONLY = {'Woodblock', 'Ball Whistle', 'Train Whistle, Toy'}
FAMILY = {'percussion', 'percussion hit', 'hand percussion', 'bell', 'mallet instrument', 'tuned percussion', 'cymbal', 'drums', 'metallic', 'synthesizer'}
BASE_ABSENT = ['voice', 'drum loop', 'electric guitar', 'bass guitar', 'synth bass', '808 bass', 'kick', 'guitar', 'strings']
TAUGHT = sorted(({l for ls in FOLDERS.values() for l in ls} | set(BASE_ABSENT)) & set(CAT))

def labels_of(folder):
    present = set(FOLDERS[folder]); lab = {}
    for l in TAUGHT:
        if l in present: lab[f'cat:{l}'] = 1.0
        elif l in FAMILY: continue                    # a family label the folder does not name: unknown
        else: lab[f'cat:{l}'] = 0.0
    return lab

def test_folders():
    by = defaultdict(list)
    for f, ls in FOLDERS.items(): by[ls[0]].append(f)
    held = set(TEST_ONLY)
    for l, fs in by.items():
        if len(fs) >= 2 and not set(fs) & held: held.add(sorted(fs, key=lambda f: h('dge-vcsl-test', f))[0])
    return held

def get(url):
    for i in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as r: return r.read()
        except Exception:
            if i == 5: raise
            time.sleep(3 * (i + 1))

def file_list(out):
    d = os.path.join(out, 'vcsl-git')
    if not os.path.isdir(d):
        subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', f'https://github.com/{REPO}.git', d], check=True)
    names = subprocess.run(['git', '-C', d, 'ls-tree', '-r', '--name-only', SHA], capture_output=True, text=True, check=True).stdout.splitlines()
    return [n for n in names if n.lower().endswith(('.wav', '.mp3', '.flac', '.aif', '.aiff')) and len(n.split('/')) >= 4 and n.split('/')[2] in FOLDERS]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--per-folder', type=int, default=40)
    ap.add_argument('--workers', type=int, default=16); ap.add_argument('--limit', type=int, default=0); ap.add_argument('--list', action='store_true')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    held = test_folders(); by = defaultdict(list)
    for n in file_list(args.out): by[n.split('/')[2]].append(n)
    train, test = [], []
    for f, ns in sorted(by.items()):
        ns = sorted(ns, key=lambda n: h('dge-vcsl-pick', n))[:args.per_folder]      # cap big folders (pianos, organs)
        (test if f in held else train).extend((f, n) for n in ns)
    if args.limit: train, test = train[:args.limit], test[:args.limit // 4]
    pos = lambda rows: Counter(l for f, _ in rows for l in FOLDERS[f])
    print(f'vcsl: {len(train)} train files, {len(test)} held-out test files from {len(held & set(by))} folders ({sorted(held & set(by))})', flush=True)
    print('  train positives ' + ', '.join(f'{k} {v}' for k, v in pos(train).most_common()), flush=True)
    print('  test positives ' + ', '.join(f'{k} {v}' for k, v in pos(test).most_common()), flush=True)
    if args.list: return
    import numpy as np
    import importlib.util
    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prepare-extra.py'))
    pe = importlib.util.module_from_spec(spec); spec.loader.exec_module(pe)
    def fetch(row):
        f, n = row
        try:
            x = pe.decode(get(f'https://raw.githubusercontent.com/{REPO}/{SHA}/' + urllib.parse.quote(n)))
            return row, x
        except Exception: return row, None
    w = pe.Writer(args.out, 'vcsl', 1000)
    with ThreadPoolExecutor(args.workers) as pool:
        for (f, n), x in pool.map(fetch, train):
            if x is None: continue
            w.add({'id': f'vcsl:{n}', 'artist': f'vcsl:{f}', 'val': int(h('dge-vcsl-val', f)[:8], 16) % 8 == 0,
                   'labels': labels_of(f), 'weakAbsent': [], 'source': 'vcsl'}, x)
        items, wavs = [], []
        for (f, n), x in pool.map(fetch, test):
            if x is None: continue
            wavs.append((x * 32767).astype(np.int16))
            items.append({'id': f'vcsl:{n}', 'artist': f'vcsl:{f}', 'labels': {k: 'present' if v else 'absent' for k, v in labels_of(f).items()}})
    np.save(os.path.join(args.out, 'eval-vcsl.npy'), np.stack(wavs) if wavs else np.zeros((0, 320000), np.int16))
    json.dump({'source': f'VCSL {SHA[:7]} (CC0), held-out folders {sorted(held & set(by))}: test only', 'heldFolders': sorted(held & set(by)), 'items': items},
              open(os.path.join(args.out, 'eval-vcsl.json'), 'w'))
    print(f'eval-vcsl: {len(items)} held-out clips', flush=True)
    w.close(f'VCSL, github.com/{REPO}@{SHA[:7]} (CC0 1.0); held-out folders excluded')

if __name__ == '__main__':
    main()
