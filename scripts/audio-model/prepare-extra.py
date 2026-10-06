"""More labelled audio for the tagger's app-named head, one source per call (labels in labelmap.py):

  tinysol   TinySOL recorded orchestral notes (Zenodo 3685367, CC BY 4.0); folds 0-1 are left for the short-clip
            test of the "Fix failing sound tags" work, fold 2 is validation, folds 3-4 train
  egfx      EGFxSet electric-guitar notes through 12 real pedals (Zenodo 7044411, CC BY 4.0); every pedal version of
            a note stays on one side of the split
  fsld      Freesound Loop Dataset loops with expert instrumentation ticks (Zenodo 3967852; per-loop CC licences),
            minus the DJ-label test loops, the short-clip and synth-clip reserved sounds and uploaders, and FSD50K eval
  waivops   WaivOps EDM-HSE and EDM-TECH rendered drum loops with their MIDI drum notes (Zenodo 13769544, 17584890,
            CC BY 4.0); every --every'th loop
  djfx      DJ effect clips from Freesound (4,770 public previews, labels mined from uploader tags by the SoundCloud
            thread, PR #141): its "train" uploaders only, minus CC BY-NC and Sampling+ clips; its "heldout" uploaders are
            written as eval-djfx.npy/.json and never trained on. A label related to one a clip has (labels.json
            "overlap") is left unlabelled for that clip, as #141 scores it
  surge     Surge synthesizer preset renders (Zenodo 4677097, CC BY 4.0), --per-preset notes of each preset in MIDI 36-84;
            all notes of a preset stay on one side of the split

Usage: python3 scripts/audio-model/prepare-extra.py <source> <out-dir> [--limit N] [--every 2] [--per-preset 6]
  -> <source>-mel.npy + <source>.json   training windows (10 s, or 600 frames for 4 s notes; train.py pads with silence)
Labels are strong (a source knows every label it teaches), except where labelmap.py says otherwise.
"""
import argparse, csv, time, hashlib, io, json, os, re, subprocess, sys, tarfile, urllib.request, warnings, zipfile
from collections import defaultdict
import numpy as np
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labelmap as L  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
Z = 'https://zenodo.org/records/{}/files/{}?download=1'
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
RATE = 32000

class HttpFile(io.RawIOBase):
    """A seekable view of a remote file through HTTP range requests, so zipfile reads only the members it needs."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=120) as r: self.size = int(r.headers['Content-Length'])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off; return self.pos
    def readinto(self, b):
        if self.pos >= self.size: return 0
        end = min(self.size, self.pos + len(b)) - 1
        for i in range(6):
            try:
                with urllib.request.urlopen(urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{end}'}), timeout=120) as r: d = r.read()
                break
            except Exception:
                if i == 5: raise
                import time; time.sleep(2 * (i + 1))
        b[:len(d)] = d; self.pos += len(d); return len(d)

def remote_zip(record, name): return zipfile.ZipFile(io.BufferedReader(HttpFile(Z.format(record, name)), 1 << 20))
def local_zip(record, name, out):
    """Downloads a whole zip (when every member is needed) to out/<name>; the caller deletes it."""
    path = os.path.join(out, name)
    subprocess.run(['curl', '-fsSL', '--retry', '6', '-o', path, Z.format(record, name)], check=True); return zipfile.ZipFile(path), path
def stream(record, name):
    for i in range(6):
        try: return urllib.request.urlopen(Z.format(record, name), timeout=300)
        except Exception:
            if i == 5: raise
            import time; time.sleep(5 * (i + 1))

def decode(data, secs=10):
    """Any audio file's bytes -> mono float32 at 32 kHz, at most `secs` long, padded with silence to `secs`."""
    try:
        pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-t', str(secs), '-ac', '1', '-ar', str(RATE), '-f', 's16le', 'pipe:1'],
                             input=data, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError: return None
    x = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    if len(x) < RATE // 4 or np.abs(x).max() < 1e-3: return None
    n = int(secs * RATE); return np.pad(x[:n], (0, n - len(x[:n])))

class Writer:
    """Collects (item, audio) pairs into <name>-mel.npy [N,128,frames] float16 and <name>.json."""
    def __init__(self, out, name, frames=1000):
        import torch
        sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
        from models.preprocess import AugmentMelSTFT
        torch.set_num_threads(2); self.torch = torch; self.mel = AugmentMelSTFT(n_mels=128, sr=RATE, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
        self.out, self.name, self.frames = out, name, frames
        self.raw_path = os.path.join(out, f'{name}-mel.raw'); self.raw = open(self.raw_path, 'wb'); self.items, self.batch = [], []
    def add(self, item, x):
        self.batch.append((item, x))
        if len(self.batch) == 64: self.flush()
    def flush(self):
        if not self.batch: return
        n = max(len(x) for _, x in self.batch)
        a = np.stack([np.pad(x, (0, n - len(x))) for _, x in self.batch])
        with self.torch.no_grad(): m = self.mel(self.torch.from_numpy(a))[:, :, :self.frames].numpy().astype(np.float16)
        if m.shape[2] < self.frames: m = np.pad(m, ((0, 0), (0, 0), (0, self.frames - m.shape[2])), constant_values=-1.4025)
        for (it, _), v in zip(self.batch, m):
            self.raw.write(v.tobytes()); it['row'] = len(self.items)
            if self.frames != 1000: it['frames'] = self.frames
            self.items.append(it)
        self.batch.clear()
    def close(self, source):
        self.flush(); self.raw.close()
        src = np.memmap(self.raw_path, dtype=np.float16, mode='r', shape=(len(self.items), 128, self.frames))
        dst = np.lib.format.open_memmap(os.path.join(self.out, f'{self.name}-mel.npy'), mode='w+', dtype=np.float16, shape=src.shape)
        for k in range(0, len(self.items), 2048): dst[k:k + 2048] = src[k:k + 2048]
        dst.flush(); del dst, src; os.remove(self.raw_path)
        json.dump({'source': source, 'frames': self.frames, 'items': self.items}, open(os.path.join(self.out, f'{self.name}.json'), 'w'))
        pos = defaultdict(int); nval = sum(bool(it.get('val')) for it in self.items)
        for it in self.items:
            for k, v in it['labels'].items(): pos[k] += v
        print(f'{self.name}: {len(self.items)} windows ({nval} validation); positives ' + ', '.join(f'{k[4:] if k.startswith("cat:") else k} {int(v)}' for k, v in sorted(pos.items(), key=lambda kv: kv[1])), flush=True)

def labelled(present, taught, weak=()):
    """Item labels: every taught label, present or absent; `weak` absences are listed for the weak weight."""
    lab = {f'cat:{l}': float(l in present) for l in taught}
    return lab, sorted(f'cat:{l}' for l in weak if l not in present and l in taught)

def tinysol(args, w):
    meta = list(csv.DictReader(io.StringIO(stream(3685367, 'TinySOL_metadata.csv').read().decode())))
    by_path = {r['Path']: r for r in meta}
    taught = sorted({l for v in L.TINYSOL.values() for l in v})
    with tarfile.open(fileobj=stream(3685367, 'TinySOL.tar.gz'), mode='r|gz') as tar:
        for m in tar:
            if args.limit and len(w.items) + len(w.batch) >= args.limit: break
            key = m.name.split('TinySOL/', 1)[-1].removeprefix('./')
            if not m.isfile() or key not in by_path: continue
            r = by_path[key]
            if r['Fold'] in ('0', '1'): continue                     # reserved: "Fix failing sound tags" tests on folds 0-1
            x = decode(tar.extractfile(m).read())
            if x is None: continue
            lab, weak = labelled(set(L.TINYSOL[r['Instrument (in full)']]), taught)
            w.add({'id': f'tinysol:{key}', 'artist': f'tinysol:{r["Instrument (in full)"]}', 'val': r['Fold'] == '2', 'labels': lab, 'weakAbsent': weak}, x)
    return 'TinySOL, Zenodo 3685367 (CC BY 4.0)'

def egfx(args, w):
    per = max(1, args.limit // len(L.EGFX)) if args.limit else 0
    for pedal, present in L.EGFX.items():
        z, path = local_zip(7044411, f'{pedal}.zip', args.out) if not args.limit else (remote_zip(7044411, f'{pedal}.zip'), None); n = 0
        for name in sorted(z.namelist()):
            if not name.endswith('.wav') or (per and n >= per): continue
            note = name.split('/', 1)[1]                                 # pickup/string-fret, shared by every pedal's version
            x = decode(z.read(name))
            if x is None: continue
            # Overdrive is a mild distortion and the RAT strong overdrive: each leaves the other label unknown.
            lab, weak = labelled(set(present) | {'guitar', 'electric guitar'}, L.EGFX_TAUGHT,
                                 weak=['distorted'] if 'saturated' in present else ['saturated'] if 'distorted' in present else [])
            for k in weak: lab.pop(k, None)
            w.add({'id': f'egfx:{pedal}/{note}', 'artist': f'egfx:{note}', 'val': int(h('dge-egfx-val', note)[:8], 16) % 10 == 0,
                   'labels': lab, 'weakAbsent': []}, x); n += 1
        if path: os.remove(path)
        print(f'  egfx {pedal}: {n}', flush=True)
    return 'EGFxSet, Zenodo 7044411 (CC BY 4.0)'

def fsld(args, w):
    from huggingface_hub import hf_hub_download
    ann = zipfile.ZipFile(io.BytesIO(stream(3967852, 'annotations.zip').read()))
    ticks = defaultdict(list)
    for n in ann.namelist():
        mm = re.search(r'sound-(\d+)\.json$', n)
        if not mm: continue
        a = json.loads(ann.read(n))
        if a.get('discard'): continue
        ticks[mm.group(1)].append({r: str(a['instrumentation'].get(r)).lower() == 'true' for r in L.FSLD_ROLES})
    sc = open(os.path.join(ROOT, 'docs/evaluations/dj-labels-2026-10-04/scorecard.json')).read()
    bad_ids = set(re.findall(r'fsld_(\d+)', sc)); bad_users = set()
    bad_ids |= {r['fname'] for r in csv.DictReader(open(hf_hub_download('Fhrozen/FSD50k', 'labels/eval.csv', repo_type='dataset')))}
    for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
        d = json.load(open(os.path.join(ROOT, f)))
        bad_ids |= set(map(str, d.get('freesoundIds', [])))
        bad_users |= {u.removeprefix('freesound-user:') for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
    z = remote_zip(3967852, 'FSL10K.zip'); meta = json.loads(z.read('metadata.json'))
    wav = {n.split('/')[-1].split('_')[0]: n for n in z.namelist() if n.startswith('audio/wav/') and n.endswith('.wav')}
    skipped = 0
    for sid in sorted(ticks, key=lambda s: wav.get(s, '')):
        if args.limit and len(w.items) + len(w.batch) >= args.limit: break
        user = (meta.get(sid) or {}).get('username')
        if sid not in wav or not user or sid in bad_ids or user in bad_users or int(h('synth-fresh-up', f'freesound-user:{user}')[:8], 16) % 5 == 0:
            skipped += 1; continue
        x = decode(z.read(wav[sid]))
        if x is None: continue
        votes = ticks[sid]; lab, weak = {}, []
        for r in L.FSLD_ROLES:   # annotators agree -> strong; split vote -> weak absence
            share = sum(v[r] for v in votes) / len(votes); lab[f'fsld:{r}'] = float(share >= .5)
            if 0 < share < .5: weak.append(f'fsld:{r}')
        lab['cat:sound effect'] = lab['fsld:fx']
        if 'fsld:fx' in weak: weak.append('cat:sound effect')
        w.add({'id': f'fsld:{sid}', 'artist': f'freesound-user:{user}', 'labels': lab, 'weakAbsent': weak}, x)
    print(f'  fsld: {skipped} annotated loops skipped (test, reserved or missing)', flush=True)
    return 'Freesound Loop Dataset, Zenodo 3967852 (per-loop Freesound CC licences)'

def waivops(args, w):
    for record, prefix in ((13769544, 'edm_hse_id_001-004'), (17584890, 'edm_tech_drm')):
        keymap = {x['note']: x['label'].lower() for x in json.load(stream(record, 'key_map_drum_note_labels.json'))['key_map_drum_note_labels']}
        notes = {}
        with tarfile.open(fileobj=stream(record, f'{prefix}_json.tar.gz'), mode='r|gz') as tar:
            for m in tar:
                if m.isfile() and m.name.endswith('.json'): notes.update(json.load(tar.extractfile(m)))
        n = 0
        with tarfile.open(fileobj=stream(record, f'{prefix}_wav.tar.gz'), mode='r|gz') as tar:
            for m in tar:
                if args.limit and n >= args.limit // 2: break
                if not m.isfile() or not m.name.endswith('.wav'): continue
                loop = os.path.basename(m.name)[:-4]
                if loop not in notes or int(h('dge-waivops-pick', loop)[:8], 16) % args.every: continue
                x = decode(tar.extractfile(m).read())
                if x is None: continue
                present = {'drums', 'drum loop'}
                for p in notes[loop]['pitch']:
                    name = keymap.get(p, '')
                    for key, ls in L.WAIVOPS:
                        if key in name: present |= set(ls); break
                lab, weak = labelled(present, L.WAIVOPS_TAUGHT)
                group = re.sub(r'^\d+bpm_', '', loop)
                w.add({'id': f'waivops:{loop}', 'artist': f'waivops:{group}', 'labels': lab, 'weakAbsent': weak}, x); n += 1
        print(f'  waivops {prefix}: {n}', flush=True)
    return 'WaivOps EDM-HSE and EDM-TECH, Zenodo 13769544 and 17584890 (CC BY 4.0)'

def surge(args, w):
    def labels_of(preset):
        parts = preset.removeprefix('surge-patches-').removesuffix('-velocity64').split('-')
        cat = next((p for p in parts if p in L.SURGE_CATEGORY), None); name = ' '.join(parts).lower()
        if cat is None and any(p in ('Drums', 'Kick', 'Snare', 'Hat', 'Percussion', 'FX', 'Soundscapes', 'Templates', 'Splits', 'MPE') for p in parts): return None
        out = set(L.SURGE_CATEGORY.get(cat, []))
        for word, ls in L.SURGE_WORDS:
            if re.search(r'(^|\s)' + word, name): out |= set(ls)
        bass = 'synth bass' in out
        if bass and re.search(r'(^|\s)sub(\s|$)', name): out.add('sub bass')
        if bass and 'acid synth' in out: out.add('acid bass')
        if bass and 'synth pluck' in out: out.add('bass pluck')
        if not bass: out -= {'wobble bass', 'bass growl', '808 bass', 'reese bass'}
        return out
    taken = defaultdict(int)
    with tarfile.open(fileobj=stream(4677097, 'surge-velocity64-2K.tar'), mode='r|') as tar:
        for m in tar:
            if args.limit and len(w.items) + len(w.batch) >= args.limit: break
            if not m.isfile() or '/._' in m.name or not m.name.endswith('.ogg'): continue
            preset, note = m.name.split('/')[-2:]; pitch = int(re.sub(r'\D', '', note) or 0)
            if not 36 <= pitch <= 84 or int(h('dge-surge-note', preset, pitch)[:8], 16) % 8 or taken[preset] >= args.per_preset: continue
            ls = labels_of(preset)
            if ls is None: continue
            x = decode(tar.extractfile(m).read(), secs=6)
            if x is None: continue
            # Category names are a weak guide (a 'Lead' can sound like a pad), so other roles are weak absences.
            lab, weak = labelled(ls | {'synthesizer'}, L.SURGE_ROLES + ['synthesizer'], weak=L.SURGE_ROLES)
            w.add({'id': f'surge:{preset}/{note}', 'artist': f'surge:{preset}', 'val': int(h('dge-surge-val', preset)[:8], 16) % 10 == 0,
                   'labels': lab, 'weakAbsent': weak}, x); taken[preset] += 1
    return 'Surge preset renders, Zenodo 4677097 (CC BY 4.0)'

DJFX_SHA = '32c438f8130318d0352faf187e1e21f921820cba'   # claude/soundcloud-training-j0wc3t (PR #141)
DJFX = 'https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer/' + DJFX_SHA + '/'

def djfx(args, w):
    from concurrent.futures import ThreadPoolExecutor
    clips = json.load(urllib.request.urlopen(DJFX + 'docs/evaluations/dj-effects-2026-10-06/clips.json'))['clips']
    overlap = json.load(urllib.request.urlopen(DJFX + 'scripts/dj-effects/labels.json'))['overlap']
    taught = sorted({l for c in clips for l in c['labels']})
    related = lambda a, b: a == b or any(a in g and b in g for g in overlap)
    def labels(c):   # present, absent, or left out when related to a label the clip has (uploader tags are incomplete)
        return {f'cat:{l}': float(l in c['labels']) for l in taught if l in c['labels'] or not any(related(l, o) for o in c['labels'])}
    def fetch(c):
        for k in range(4):
            try: return decode(urllib.request.urlopen(c['preview'], timeout=60).read())
            except Exception: time.sleep(2 ** k)
        return None
    train = [c for c in clips if c['split'] == 'train' and '/by-nc' not in c['licence'] and 'sampling+' not in c['licence']]
    test = [c for c in clips if c['split'] == 'heldout']
    if args.limit: train, test = train[:args.limit], test[:args.limit // 4]
    with ThreadPoolExecutor(16) as pool:
        for c, x in zip(train, pool.map(fetch, train)):
            if x is not None: w.add({'id': c['id'], 'artist': f'freesound-user:{c["username"]}', 'labels': labels(c)}, x)
        items, wavs = [], []
        for c, x in zip(test, pool.map(fetch, test)):
            if x is None: continue
            wavs.append((x * 32767).astype(np.int16))
            items.append({'id': c['id'], 'artist': f'freesound-user:{c["username"]}', 'labels': {k: 'present' if v else 'absent' for k, v in labels(c).items()}})
    np.save(os.path.join(args.out, 'eval-djfx.npy'), np.stack(wavs) if wavs else np.zeros((0, 320000), np.int16))
    json.dump({'source': f'DJ effect clips, held-out uploaders ({DJFX_SHA[:7]})', 'items': items}, open(os.path.join(args.out, 'eval-djfx.json'), 'w'))
    print(f'eval-djfx: {len(items)} of {len(test)} held-out clips', flush=True)
    return f'Freesound previews (CC0 / CC BY), DJ effect labels from PR #141 at {DJFX_SHA[:7]}'

SOURCES = {'tinysol': (tinysol, 1000), 'egfx': (egfx, 1000), 'fsld': (fsld, 1000), 'waivops': (waivops, 1000), 'surge': (surge, 600), 'djfx': (djfx, 1000)}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('source', choices=SOURCES); ap.add_argument('out')
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--every', type=int, default=2); ap.add_argument('--per-preset', type=int, default=6)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    fn, frames = SOURCES[args.source]; w = Writer(args.out, args.source, frames)
    w.close(fn(args, w))

if __name__ == '__main__':
    main()
