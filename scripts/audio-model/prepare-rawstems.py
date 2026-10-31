"""Real full songs from Mixing Secrets raw stems, with per-window instrument presence for the tagger's app-named head.

Usage: python3 scripts/audio-model/prepare-rawstems.py <out-dir> [--windows 6] [--limit N] [--shard i/n] [--workers 4]
  -> rawstems-mel.npy  float16 [N,128,1000]   10 s windows of the summed stems, EfficientAT log-mel
  -> rawstems.json     {'source', 'items': [{id, artist: 'rawstems:<artist>', row, val, labels: {'cat:<label>': 0/1}, weakAbsent: []}]}
  With --shard the outputs are rawstems-<i>-mel.npy / rawstems-<i>.json; merge them with --merge <n> afterwards.

Source: hf://datasets/kwatcharasupat/mixing-secrets-rawstems (RawStems, Zang et al. 2025: the Cambridge Mixing Secrets
multitrack library, one folder per instrument group, e.g. Bass/, Kbs/OR/ for organ, Voc/LV/ for lead vocals). Licence:
non-commercial research and education only. Only the dev/ songs are read; its test/ mixtures and the musdb18hq/ folder
(MUSDB18 overlaps MedleyDB, which judges whole songs in docs/evaluations/whole-songs-2026-10-09) are never touched, and
songs by any MedleyDB artist are skipped.

Unlike Slakh, these are real recordings by real players. The stems are summed into the mix (raw tracks, not the
engineer's mix, so levels are rougher than a release), and what plays in a window comes from the stems themselves, as in
prepare-slakh.py --source stems: a stem is audible when its RMS over the window is above -60 dBFS and within 30 dB of
the mix. A label is 1 when an audible stem is that instrument, 0 when no audible stem is or might be (labels a stem
leaves unknown, e.g. 'brass' for a horn-section track, stay out of the window's labels so train.py gives them no weight).
Reference mixes some song folders carry are left out of the sum.

--fx SHARE (run 7) also re-renders that share of the windows with one effect from render.MUSIC_FX (picked by hash), written
as a separate source rsfx-mel.npy / rsfx.json: real music under bitcrush, flanger, chorus, saturation, filter, reverb,
delay, pitch rises and falls etc. A render is labelled with its effect, and render.CLEAR_FX effects it did not get are weak
absences; its instrument labels are left out. With --fx, dry windows also count as weak absences of render.CLEAR_FX
(raw multitrack stems are unprocessed). Renders sit on the same side of the validation split as their song.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time, warnings
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import numpy as np
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import CAT  # noqa: E402
from render import CLEAR_FX, MUSIC_FX, apply  # noqa: E402

REPO = ('kwatcharasupat/mixing-secrets-rawstems', 'b482eb2e31aa15ff10489b3b23871a1e7a109198')
RATE, SECS = 32000, 10
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

DRUM_PARTS = ['kick', 'snare', 'hi-hat', 'tom', 'cymbal']
HAND = ['hand percussion', 'shaker', 'tambourine', 'clap', 'conga', 'cowbell', 'triangle', 'cajon']
TUNED = ['mallet instrument', 'glockenspiel', 'vibraphone', 'marimba', 'xylophone', 'bell', 'steel drum']
WINDS = ['flute', 'clarinet', 'oboe', 'bassoon', 'saxophone']
BRASS = ['trumpet', 'trombone', 'horn', 'tuba', 'saxophone']
BOWED = ['strings', 'violin / fiddle', 'viola', 'cello', 'double bass']
VOCAL = ['voice', 'choir', 'whisper', 'spoken phrase', 'vocoder vocal', 'vocal chops', 'vocal phrase', 'vocal shout', 'vocal chant',
         'vocal ad-lib', 'vocal hum', 'vocal harmony', 'vocal scream', 'pitched vocal', 'breath', 'vocal breath']
FX = ['sound effect', 'noise', 'turntable', 'vinyl scratch', 'vinyl crackle', 'impact', 'riser', 'downlifter', 'whoosh', 'reverse effect',
      'reverse cymbal', 'noise sweep', 'sub drop', 'glitch effect', 'texture', 'ambient drone', 'static noise', 'foley', 'environmental sound']
SYNTHS = ['synthesizer', 'synth lead', 'atmospheric pad', 'synth bass', 'synth pluck', 'synth stab', 'synth arpeggio', 'synth chord',
          'supersaw', 'synth drone', 'synth sequence', 'string synth', 'brass synth', 'organ synth', 'bell synth', 'sub bass']
KEYS = ['piano', 'electric piano', 'organ', 'accordion', 'harmonica']
GUITARS = ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar', 'harp', 'bass guitar']
ALL = sorted(set(DRUM_PARTS + HAND + TUNED + WINDS + BRASS + BOWED + VOCAL + FX + SYNTHS + KEYS + GUITARS +
                 ['drums', 'percussion', 'gong', 'whistle', 'tabla', 'djembe']))
TAUGHT = [l for l in ALL if l in CAT]

def has(name, *words): return any(w in name for w in words)

def stem_labels(group, file):
    """(group folder like 'Kbs/OR', file name) -> (labels present, labels unknown) while the stem is audible; None = leave it out."""
    n = re.sub(r'\.(flac|wav)$', '', file.lower())
    if has(n, 'reference mix', 'ruff mix', 'rough mix', 'stringsmix'): return None
    sfx = has(n, 'sfx', 'fx', 'reverse', 'sample', 'loop') and not has(n, 'leslie')
    g = group.split('/')
    if g[0] == 'Voc':
        if has(n, 'vocoder'): return {'vocoder vocal', 'voice'}, set(VOCAL)
        if has(n, 'speech'): return {'voice', 'spoken phrase'}, set(VOCAL)
        if has(n, 'whistle'): return set(), {'whistle', 'voice'}
        if has(n, 'whisper'): return {'voice', 'whisper'}, set(VOCAL)
        if sfx: return set(), set(VOCAL) | set(FX)
        if has(n, 'gtr', 'guitar', 'banjo', 'mando', 'keys', 'bass', 'drums'): return {'voice'}, set(VOCAL) | set(ALL)   # vocal mic over an instrument
        return {'voice'}, set(VOCAL) - {'voice'}
    if g[0] == 'Gtr':
        if has(n, 'mandolin', 'banjo', 'ukelele', 'ukulele', 'guitalele'): return set(), {'guitar', 'acoustic guitar'}
        if has(n, 'vox'): return {'guitar', 'voice'}, set(VOCAL) | set(GUITARS)
        if sfx: return set(), set(GUITARS) | set(FX)
        return ({'guitar', 'acoustic guitar'}, set()) if g[1:] == ['AG'] else ({'guitar', 'electric guitar'}, {'steel guitar'})
    if g[0] == 'Bass':
        if g[1:] == ['SB'] or has(n, 'synth', 'sub'): return {'synth bass', 'synthesizer'}, {'sub bass', 'bass guitar'}
        if has(n, 'double', 'upright', 'basses'): return {'double bass'}, {'strings', 'bass guitar'}
        if has(n, 'key', 'pedal'): return set(), {'bass guitar', 'synth bass', 'synthesizer', 'organ', 'double bass'}
        if sfx: return set(), {'bass guitar'} | set(FX)
        return {'bass guitar'}, set()
    if g[0] == 'Kbs':
        k = g[1] if len(g) > 1 else ''
        if sfx and not k == 'OR': return set(), set(KEYS) | set(SYNTHS) | set(FX)
        if k == 'OR':
            if has(n, 'accordion'): return {'accordion'}, set()
            if has(n, 'sfx'): return set(), {'organ'} | set(FX) | set(SYNTHS)
            return {'organ'}, {'organ synth'}
        if k == 'PN':
            if has(n, 'strings', 'choir', 'synth', 'pad', 'bell', 'celesta', 'toy', 'nord', 'key'): return set(), set(KEYS) | set(SYNTHS) | set(BOWED) | set(VOCAL)
            return {'piano'}, set()
        if k == 'EP': return ({'electric piano'}, {'piano'}) if has(n, 'rhodes', 'elecpiano', 'wurli', 'whirly', 'cp80') and not has(n, 'pad') \
            else (set(), {'electric piano', 'piano', 'organ', 'synthesizer'} | set(SYNTHS))
        if k == 'SYNTH': return {'synthesizer'}, set(SYNTHS)
        return set(), set(KEYS) | set(SYNTHS) | set(BOWED) | set(WINDS)            # MTR (mellotron) and anything else
    if g[0] == 'Synth':
        if has(n, 'sfx'): return set(), set(SYNTHS) | set(FX)
        if has(n, 'keys', 'nord', 'juno', 'moog', 'virus', 'korg'): return {'synthesizer'}, set(SYNTHS) | {'piano', 'electric piano', 'organ'}
        if has(n, 'pad'): return {'synthesizer', 'atmospheric pad'}, set(SYNTHS)
        if has(n, 'lead'): return {'synthesizer', 'synth lead'}, set(SYNTHS)
        return {'synthesizer'}, set(SYNTHS)
    if g[0] == 'Rhy':
        if g[1:] == ['DK']:
            if has(n, 'clap'): return {'clap', 'percussion'}, {'drums', 'hand percussion'}
            if has(n, 'reverse', 'sfx', 'fx'): return {'drums'}, set(DRUM_PARTS) | {'percussion'} | set(FX)
            return {'drums'}, set(DRUM_PARTS) | {'percussion'}
        if has(n, 'tambourine'): return {'tambourine', 'hand percussion', 'percussion'}, set()
        if has(n, 'shaker', 'maracas', 'cabasa'): return {'shaker', 'hand percussion', 'percussion'}, set()
        if has(n, 'clap', 'snap', 'click'): return {'clap', 'percussion'}, {'hand percussion'}
        if has(n, 'conga'): return {'conga', 'hand percussion', 'percussion'}, set()
        if has(n, 'cowbell'): return {'cowbell', 'percussion'}, set()
        if has(n, 'triangle'): return {'triangle', 'percussion'}, set()
        if has(n, 'cajon'): return {'cajon', 'hand percussion', 'percussion'}, set()
        if has(n, 'glockenspiel'): return {'glockenspiel', 'mallet instrument'}, {'bell'}
        if has(n, 'vibes', 'vibraphone'): return {'vibraphone', 'mallet instrument'}, set()
        if has(n, 'marimba'): return {'marimba', 'mallet instrument'}, set()
        if has(n, 'steelpan'): return {'steel drum'}, {'mallet instrument'}
        if has(n, 'gong'): return {'gong'}, {'percussion'}
        if has(n, 'bell', 'chime'): return set(), {'bell', 'mallet instrument', 'glockenspiel'}
        if has(n, 'timpani', 'taiko'): return set(), {'drums', 'percussion'}
        return {'percussion'}, set(HAND) | {'drums', 'tabla', 'djembe'} | set(TUNED) | set(FX)
    if g[0] == 'Orch':
        k = g[1] if len(g) > 1 else ''
        if k == 'STR':
            if has(n, 'harp'): return {'harp'}, set()
            if has(n, 'hurdy', 'sfx', 'reverse', 'midi', 'sample'): return set(), set(BOWED) | set(FX) | {'string synth'}
            if has(n, 'cello'): return {'cello'}, {'strings'}
            if has(n, 'viola', 'vla'): return {'viola'}, {'strings'}
            if has(n, 'violin', 'fiddle', 'vln'): return {'violin / fiddle'}, {'strings'}
            if has(n, 'bass'): return {'double bass'}, {'strings'}
            return {'strings'}, set(BOWED)
        if k == 'BR':
            if has(n, 'sax', 'tenor', 'bari'): return {'saxophone'}, set()
            if has(n, 'trumpet'): return {'trumpet'}, set()
            if has(n, 'bone'): return {'trombone'}, set()
            if has(n, 'tuba', 'sousaphone'): return {'tuba'}, set()
            if has(n, 'frenchhorn', 'horn 1') or n.endswith('horn'): return {'horn'}, set()
            return set(), set(BRASS) | {'brass synth'}
        if k == 'WW':
            if has(n, 'sax'): return {'saxophone'}, set()
            if has(n, 'bassoon'): return {'bassoon'}, set()
            if has(n, 'clarinet'): return {'clarinet'}, set()
            if has(n, 'oboe'): return {'oboe'}, set()
            if has(n, 'flute', 'piccolo', 'recorder', 'recordier', 'shakuhachi'): return {'flute'}, set()
            if has(n, 'whistle'): return set(), {'flute', 'whistle'}
            return set(), set(WINDS) | set(BRASS) | {'whistle'}
        return set(), set(BOWED) | set(BRASS) | set(WINDS)
    if g[0] == 'Misc' and len(g) == 1:
        if has(n, 'harmonica'): return {'harmonica'}, set()
        if has(n, 'harp'): return {'harp'}, set()
        if has(n, 'scratch') and not has(n, 'scractch'): return {'vinyl scratch', 'turntable', 'sound effect'}, set(FX)
        if has(n, 'vinylnoise'): return {'vinyl crackle'}, set(FX)
    return set(), set(ALL)                                                          # anything else may be anything

def window_labels(on, stems):
    """on: stem -> audible in this window. Returns the window's labels (unknown ones left out)."""
    out = {}
    for l in TAUGHT:
        if any(on[s] and l in stems[s][0] for s in stems): out[f'cat:{l}'] = 1.0
        elif not any(on[s] and l in stems[s][0] | stems[s][1] for s in stems): out[f'cat:{l}'] = 0.0
    return out

def decode(path):
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.float32)

def rms_db(x): return 10 * np.log10(np.mean(x.astype(np.float64) ** 2) + 1e-12)

def windows_of(n, k):
    w = SECS * RATE
    if n <= w: return [0]
    return sorted({int(round((n - w) * (j + 0.5) / k)) for j in range(k)})

def song(args, folder, files):
    """-> (list of (item, int16 window), seconds) for one song folder ('dev/<Artist - Title>')."""
    from huggingface_hub import hf_hub_download
    dest = os.path.join(args.cache, h(folder)[:12]); t0 = time.time()
    try:
        stems, audio = {}, {}
        for f in files:
            group = '/'.join(f.split('/')[2:-1]); lab = stem_labels(group, f.split('/')[-1])
            if lab is None: continue
            for i in range(6):
                try: p = hf_hub_download(REPO[0], f, repo_type='dataset', revision=REPO[1], local_dir=dest); break
                except Exception:
                    if i == 5: raise
                    time.sleep(3 * (i + 1))
            stems[f], audio[f] = lab, decode(p); os.remove(p)
        if not stems: return [], time.time() - t0
        n = max(len(a) for a in audio.values())
        mix = np.zeros(n, np.float32)
        for a in audio.values(): mix[:len(a)] += a
        scale = 0.9 / max(1e-6, float(np.abs(mix).max()))                            # one gain for the mix and every stem
        artist = folder.split('/')[1].split(' - ')[0]
        out = []
        for a in windows_of(n, args.windows):
            x = mix[a:a + SECS * RATE] * scale; x = np.pad(x, (0, SECS * RATE - len(x)))
            if rms_db(x) < -50: continue
            mx = rms_db(x)
            on = {s: (lambda y: rms_db(y) > -60 and rms_db(y) >= mx - 30)(audio[s][a:a + SECS * RATE] * scale) if len(audio[s]) > a else False for s in stems}
            wid, val = f'rawstems:{folder.split("/")[1]}@{a / RATE:.1f}', int(h('dge-rawstems-val', artist)[:8], 16) % 8 == 0
            lab, weak = window_labels(on, stems), []
            if args.fx:
                lab.update({f'cat:{e}': 0.0 for e in CLEAR_FX}); weak = [f'cat:{e}' for e in CLEAR_FX]
            out.append(({'id': wid, 'artist': f'rawstems:{artist}', 'val': val, 'labels': lab, 'weakAbsent': weak},
                        np.clip(x * 32767, -32768, 32767).astype(np.int16)))
            if args.fx and int(h('dge-rsfx-on', wid)[:8], 16) % 1000 < args.fx * 1000:
                e = MUSIC_FX[int(h('dge-rsfx-pick', wid)[:8], 16) % len(MUSIC_FX)]
                y = apply(e, x.astype(np.float64), f'rsfx|{wid}|{e}')
                if y is not None:
                    flab = {f'cat:{e}': 1.0, **{f'cat:{c}': 0.0 for c in CLEAR_FX if c != e}}
                    out.append(({'id': f'{wid}#{e}', 'artist': f'rawstems:{artist}', 'val': val, 'labels': flab,
                                 'weakAbsent': [f'cat:{c}' for c in CLEAR_FX if c != e], 'fx': e},
                                np.clip(y * 32767, -32768, 32767).astype(np.int16)))
        return out, time.time() - t0
    except Exception as e:
        print(f'  skip {folder}: {type(e).__name__}: {e}', flush=True); return [], time.time() - t0
    finally: shutil.rmtree(dest, ignore_errors=True)

def medleydb_artists():
    """Normalised MedleyDB artist names (medleydb-artists.json, from the judge set's MedleyDB metadata)."""
    return set(json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'medleydb-artists.json'))))

def merge(out, n):
    items, mels = [], []
    for i in range(n):
        d = json.load(open(os.path.join(out, f'rawstems-{i}.json')))
        m = np.load(os.path.join(out, f'rawstems-{i}-mel.npy'), mmap_mode='r')
        base = sum(x.shape[0] for x in mels)
        for it in d['items']: it['row'] += base
        items += d['items']; mels.append(m); source = d['source']
    dst = np.lib.format.open_memmap(os.path.join(out, 'rawstems-mel.npy'), mode='w+', dtype=np.float16, shape=(len(items), 128, 1000))
    k = 0
    for m in mels: dst[k:k + len(m)] = m; k += len(m)
    dst.flush()
    json.dump({'source': source, 'items': items}, open(os.path.join(out, 'rawstems.json'), 'w'))
    for i in range(n): os.remove(os.path.join(out, f'rawstems-{i}.json')); os.remove(os.path.join(out, f'rawstems-{i}-mel.npy'))
    summary(items)

def summary(items):
    pos, known = defaultdict(int), defaultdict(int)
    for it in items:
        for c, v in it['labels'].items(): pos[c[4:]] += v; known[c[4:]] += 1
    print(f'rawstems: {len(items)} windows ({sum(it["val"] for it in items)} validation) from {len({it["id"].split("@")[0] for it in items})} songs; '
          'positives/known ' + ', '.join(f'{l} {int(pos[l])}/{known[l]}' for l in sorted(TAUGHT, key=lambda l: (-pos[l], l))), flush=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--windows', type=int, default=6); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--workers', type=int, default=4); ap.add_argument('--shard', default=''); ap.add_argument('--merge', type=int, default=0)
    ap.add_argument('--fx', type=float, default=0.0, help='share of windows also re-rendered with one effect (rsfx source)')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    if args.merge: return merge(args.out, args.merge)
    args.cache = os.path.join(args.out, 'rawstems-download')
    from huggingface_hub import HfApi
    files = [f for f in HfApi().list_repo_files(REPO[0], repo_type='dataset', revision=REPO[1]) if f.startswith('dev/') and re.search(r'\.(flac|wav)$', f)]
    by = defaultdict(list)
    for f in files: by['/'.join(f.split('/')[:2])].append(f)
    held = medleydb_artists()
    folders = sorted((s for s in by if re.sub(r'[^a-z0-9]', '', s.split('/')[1].split(' - ')[0].lower()) not in held), key=lambda s: h('dge-rawstems', s))
    print(f'{len(by)} dev songs, {len(by) - len(folders)} skipped as MedleyDB artists', flush=True)
    if args.limit: folders = folders[:args.limit]
    tag = ''
    if args.shard:
        i, n = map(int, args.shard.split('/')); folders = folders[i::n]; tag = f'-{i}'
    print(f'{len(folders)} songs, {args.windows} windows each; {len(TAUGHT)} labels', flush=True)

    import torch
    sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
    from models.preprocess import AugmentMelSTFT
    mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
    raw_path = os.path.join(args.out, f'rawstems{tag}-mel.raw'); raw = open(raw_path, 'wb'); items, batch = [], []
    fx_path = os.path.join(args.out, f'rsfx{tag}-mel.raw'); fx_raw = open(fx_path, 'wb') if args.fx else None; fx_items, fx_batch = [], []
    def flush(batch=batch, raw=raw, items=items):
        if not batch: return
        with torch.no_grad(): m = mel(torch.from_numpy(np.stack([x for _, x in batch]).astype(np.float32) / 32768))[:, :, :1000].numpy().astype(np.float16)
        for (it, _), v in zip(batch, m):
            raw.write(v.tobytes()); it['row'] = len(items); items.append(it)
        batch.clear()
    flush_fx = lambda: flush(fx_batch, fx_raw, fx_items)
    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as pool:
        for k, (got, s) in enumerate(pool.map(lambda f: song(args, f, by[f]), folders)):
            for it, x in got:
                if it.get('fx'):
                    fx_batch.append((it, x))
                    if len(fx_batch) == 64: flush_fx()
                    continue
                batch.append((it, x))
                if len(batch) == 64: flush()
            if k % 10 == 0: print(f'  song {k}/{len(folders)}  {len(items) + len(batch)} windows  {time.time() - t0:.0f} s', flush=True)
    flush(); raw.close(); shutil.rmtree(args.cache, ignore_errors=True)
    if fx_raw: flush_fx(); fx_raw.close()
    src_note = f'Mixing Secrets raw stems (RawStems, Zang et al. 2025; non-commercial research only): hf://datasets/{REPO[0]}@{REPO[1][:7]} dev/'
    for name, path, its, note in (('rawstems', raw_path, items, 'summed stems, presence from stem RMS'),
                                  ('rsfx', fx_path, fx_items, 'summed stems re-rendered with one effect (render.MUSIC_FX)')):
        if name == 'rsfx' and not args.fx: continue
        src = np.memmap(path, dtype=np.float16, mode='r', shape=(len(its), 128, 1000)) if its else np.zeros((0, 128, 1000), np.float16)
        dst = np.lib.format.open_memmap(os.path.join(args.out, f'{name}{tag}-mel.npy'), mode='w+', dtype=np.float16, shape=src.shape)
        for k in range(0, len(its), 2048): dst[k:k + 2048] = src[k:k + 2048]
        dst.flush(); del dst, src; os.remove(path)
        json.dump({'source': f'{src_note}, {note}', 'items': its}, open(os.path.join(args.out, f'{name}{tag}.json'), 'w'))
    summary(items)
    if args.fx: print('rsfx: ' + ', '.join(f'{k} {v}' for k, v in Counter(it['fx'] for it in fx_items).most_common()), flush=True)

if __name__ == '__main__':
    main()
