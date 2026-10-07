"""Slakh2100 mixes with per-window instrument presence, for the tagger's app-named head (labels named as in labelmap.CAT).

Usage: python3 scripts/audio-model/prepare-slakh.py <out-dir> [--tracks 600] [--val-tracks 100] [--windows 4] [--limit N]
                                                    [--source midi|stems]
  -> slakh-mel.npy  float16 [N,128,1000]   10 s windows of the mix (mix.flac, never a stem), EfficientAT log-mel
  -> slakh.json     {'source', 'items': [{id, artist: 'slakh:<track>', row, val, labels: {'cat:<label>': 0/1}, weakAbsent: []}]}

Slakh2100 (Manilow et al. 2019, Zenodo 4599666, CC BY 4.0) renders Lakh MIDI songs one instrument per stem, so what
plays in a window is known outright: a mapped label is 1 when a stem of that kind is audible in the window and 0 when
none is. That gives the strong absences (no piano, no saxophone, no voice...) the tag-only sources lack.
Only the redux train split is used, plus validation tracks marked 'val': True. The test split is never read (it is kept
for a stem-truth check), nor the redux 'omitted' folder (Slakh's duplicate and broken tracks).

Sources, fetched per file from Hugging Face mirrors of slakh2100_flac_redux (pinned revisions below):
  * mix.flac: DreamyWanderer/Slakh2100-FLAC-Redux-Reduced (mix + all_src.mid per track, original split folders)
  * metadata.yaml + per-stem MIDI/Sxx.mid: aashishbishow/slakh2100_midi_only_redux
  * --source stems also reads stems/Sxx.flac from WhiRik/slakh_flac (complete redux copy, but gated: needs an
    HF_TOKEN whose account has accepted that repo's terms)
Audibility per stem and window:
  stems  stem RMS over the window is not silent (> -60 dBFS) and within 30 dB of the mix RMS -> audible, else not.
  midi   (default; no gated repo) Slakh renders each stem from exactly its MIDI file, so note activity stands in for the
         stem audio: audible when its notes sound >= 0.5 s of the window or start >= 3 times in it; silent when no note
         sounds from 3 s before the window to its end (release tails); anything between leaves that stem's labels
         unknown for the window (the key is left out, so train.py gives it no weight).
A stem's labels come from its Kontakt patch (metadata plugin_name), which is what was rendered; the MIDI program can
differ (e.g. GM 'Harmonica' is played by an organ patch). Patches whose sound is ambiguous for a label (sections,
ensembles, synth-ish keys) leave that label unknown while they play rather than calling it present or absent.
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, time, warnings
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import numpy as np
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import CAT  # noqa: E402

MIX = ('DreamyWanderer/Slakh2100-FLAC-Redux-Reduced', '368add9a2d203ba8a416c44dff8936e720f83704')   # data/<split>/<track>/mix.flac
META = ('aashishbishow/slakh2100_midi_only_redux', '83a7bd14f7ee403bb896e1d7466b7704c1831bcd')      # <split>/<track>/{metadata.yaml,MIDI/Sxx.mid}
STEMS = ('WhiRik/slakh_flac', '215c7a7ea889ad7514af9ade216a5a3da599365e')                          # <split>/<track>/stems/Sxx.flac (gated)
SPLITS = {'train': False, 'validation': True}   # split folder -> 'val'; 'test' and 'omitted' are never touched
RATE, SECS = 32000, 10
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def need(mod, pkg):
    try: return __import__(mod)
    except ImportError:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', pkg]); return __import__(mod)

# Kontakt patch (plugin_name without folder or .nkm) -> (labels it is, labels it leaves unknown while it plays).
# Every patch the redux train and validation splits use is listed; an unlisted patch leaves every label unknown.
_P = {}
def patch(names, present=(), unknown=()):
    for n in names.split(): _P[n] = (frozenset(present), frozenset(unknown))
KEYS_UNSURE = ['mallet instrument', 'bell', 'glockenspiel', 'vibraphone', 'marimba', 'xylophone', 'synthesizer', 'electric piano', 'piano']
patch('concert_grand the_giant_vibrant upright_piano grand_piano august_foerster_grand alicias_keys the_giant_hard_and_tough '
      'the_giant_modern_studio the_grandeur the_gentleman ragtime_piano', ['piano'])
patch('scarbee_a_200 scarbee_mark_I wurly_ep scarbee_pianet', ['electric piano'])
patch('harpsichord', unknown=['piano'])
patch('scarbee_clavinet_full', unknown=['electric piano'])
patch('nylon_guitar nylon_guitar2 AGML2', ['guitar', 'acoustic guitar'])   # AGML2 = Ample Guitar M Lite (acoustic)
patch('jazz_guitar jazz_guitar2 jazz_guitar3 jazz_guitar4 funk_guitar elektrik_guitar rock_guitar rhythm_rock_guitar', ['guitar', 'electric guitar'])
patch('solo_guitar harmonic_guitar', ['guitar'], ['acoustic guitar', 'electric guitar'])
patch('scarbee_jay_bass_slap_both classic_bass funk_bass pop_bass scarbee_jay_bass_both scarbee_pre_bass scarbee_rickenbacker_bass '
      'scarbee_mm_bass scarbee_rickenbacker_bass_palm_muted', ['bass guitar'])
patch('jazz_upright upright_bass upright_bass2', ['double bass'], ['strings'])            # plucked upright: not clearly 'strings'
patch('double_bass_solo double_bass_ensemble', ['double bass', 'strings'])
patch('violin_solo violin_ensemble', ['violin / fiddle', 'strings'])
patch('viola_solo viola_ensemble', ['viola', 'strings'])
patch('cello_solo cello_ensemble', ['cello', 'strings'])
patch('string_ensemble string_ensemble_essential session_strings_pro_2_ensemble_modern session_strings_pro_2_ensemble_traditional solo_strings',
      ['strings'], ['violin / fiddle', 'viola', 'cello', 'double bass'])
patch('harp', ['harp'])
patch('timpani')
patch('choir_a choir_e choir_o', ['choir'], ['voice'])
patch('trumpet trumpet_1 trumpet_2 trumpet_section mute_trumpet muted_trumpet', ['trumpet'])
patch('flugelhorn', unknown=['trumpet', 'horn'])
patch('trombone tenor_trombone bass_trombone trombone_section', ['trombone'])
patch('tuba', ['tuba'])
patch('horn_1_essential horn_2_essential', ['horn'])
patch('brass_quartet_essential', unknown=['trumpet', 'trombone', 'horn', 'tuba'])
patch('session_horns_pro_keyswitch_60s_horns session_horns_pro_keyswitch_generic_section', unknown=['trumpet', 'trombone', 'saxophone', 'horn', 'tuba'])
patch('saxophones_essential saxophone_essential saxophone_section alto_saxophone alto_sax_vintage_solo tenor_sax tenor_saxophone '
      'baritone_sax_vintage_solo baritone_saxophone', ['saxophone'])
patch('clarinet clarinet_combi clarinet_essential clarinets_essential', ['clarinet'])
patch('oboe oboe_essential oboes_essential french_oboe', ['oboe'])
patch('english_horn', unknown=['oboe', 'horn'])
patch('bassoon bassoon_combi bassoon_essential bassoons_essential', ['bassoon'])
patch('woodwind_quintet_essential woodwind_ensemble_essential', unknown=['flute', 'oboe', 'clarinet', 'bassoon', 'horn', 'saxophone'])
patch('flute flute_essential flutes_essential piccolo', ['flute'])
patch('organ_kh_grprplenum_manual organ_kh_floeten_1_manual tonewheel_organ_b3 tonewheel_organ_c3 tonewheel_organ_m3 jazz_organ '
      'transistor_compact transistor_continental house_cat outta_space musicology fever', ['organ'])   # the last four: Vintage Organs presets
patch('xylophone xylophone_essential', ['xylophone', 'mallet instrument'])
patch('marimba marimba_essential hybrid_keys_concert_marimba', ['marimba', 'mallet instrument'])
patch('glockenspiel glockenspiel_essential hybrid_keys_glockenspiel', ['glockenspiel', 'mallet instrument'], ['bell'])
patch('hybrid_keys_tube_vibraphone', ['vibraphone', 'mallet instrument'])
patch('tubular_bells_wood tubular_bells_metal', ['bell'], ['mallet instrument'])
patch('celesta', unknown=['mallet instrument', 'glockenspiel', 'bell'])
patch('hybrid_keys_futurebells hybrid_keys_hot_tropics hybrid_keys_antique_toy', unknown=KEYS_UNSURE)
SYNTH_LEADS = ('pimped_analog_saw downforce_saw poly_detuned_lead crawling_lead december_saw douglas_lead hybrid_lead processor_lead '
               'hard_n_dirty percussive_lead cheesy_lead reamped_lead mystic_lead')
patch(SYNTH_LEADS, ['synth lead', 'synthesizer'])
patch('guitar_lead', ['synth lead', 'synthesizer'], ['guitar', 'electric guitar'])
patch('across_the_pacific ahoy cold_cave drifting_apart cerulean belle_de_jour arctic_morning chrystal dawn_chorus april_pan daft ambibella',
      ['atmospheric pad', 'synthesizer'])
for kit in 'pop_kit garage_kit_lite funk_kit ar_modern_sparkle_kit_full stadium_kit_full ar_modern_white_kit_full street_knowledge_kit session_kit_full'.split():
    _P[kit] = (frozenset(['drums']), frozenset())
# Sounds no Slakh patch makes (it has no vocals, and GM accordion and harmonica are played by organ patches): always known.
NEVER = ['voice', 'accordion', 'harmonica']
TAUGHT = sorted({l for p, u in _P.values() for l in p | u} | set(NEVER))
assert set(TAUGHT) <= set(CAT), sorted(set(TAUGHT) - set(CAT))

def stem_labels(stem):
    name = os.path.basename(str(stem.get('plugin_name') or '')).removesuffix('.nkm').removesuffix('.component')
    if stem.get('is_drum'): return frozenset(['drums']), frozenset()
    return _P.get(name, (frozenset(), frozenset(TAUGHT)))

def window_labels(status, stems):
    """status: stem -> 'on' | 'off' | '?' for one window. Returns the window's labels (unknown ones left out)."""
    out = {}
    for l in TAUGHT:
        if any(status[s] == 'on' and l in stems[s][0] for s in stems): out[f'cat:{l}'] = 1.0
        elif not any(status[s] != 'off' and l in stems[s][0] | stems[s][1] for s in stems): out[f'cat:{l}'] = 0.0
    return out

def note_spans(path):
    """Per-stem MIDI -> (start, end) seconds of every sounding note (sustain pedal holds note ends)."""
    mido = need('mido', 'mido')
    t, on, spans, pedal, held = 0.0, {}, [], defaultdict(bool), defaultdict(list)
    for m in mido.MidiFile(path):
        t += m.time
        if m.type == 'control_change' and m.control == 64:
            pedal[m.channel] = m.value >= 64
            if not pedal[m.channel]: spans += [(s, t) for s in held.pop(m.channel, [])]
        elif m.type == 'note_on' and m.velocity > 0: on.setdefault((m.channel, m.note), []).append(t)
        elif m.type in ('note_off', 'note_on'):
            starts = on.get((m.channel, m.note))
            if starts:
                s = starts.pop(0)
                if pedal[m.channel]: held[m.channel].append(s)
                else: spans.append((s, t))
    spans += [(s, t) for ss in on.values() for s in ss] + [(s, t) for ss in held.values() for s in ss]
    return np.array(sorted(spans), np.float64).reshape(-1, 2)

def midi_status(spans, t0, drum):
    if spans is None: return '?'
    t1 = t0 + SECS; a, b = np.clip(spans[:, 0], t0, t1), np.clip(spans[:, 1] if not drum else np.maximum(spans[:, 1], spans[:, 0] + .1), t0, t1)
    sounding, last = 0.0, t0
    for s, e in zip(a, b):                       # union length of the sorted spans inside the window
        s = max(s, last)
        if e > s: sounding += e - s; last = e
    onsets = int(((spans[:, 0] >= t0) & (spans[:, 0] < t1)).sum())
    if sounding >= 0.5 or onsets >= 3: return 'on'
    if not ((spans[:, 1] > t0 - 3) & (spans[:, 0] < t1)).any(): return 'off'
    return '?'

def rms_db(x): return 10 * np.log10(np.mean((x.astype(np.float64) / 32768) ** 2) + 1e-12)

def stem_status(stem, mix):
    """--source stems: audible when not silent and within 30 dB of the mix over the window."""
    s = rms_db(stem)
    return 'on' if s > -60 and s >= rms_db(mix) - 30 else 'off'

def decode(path):
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 's16le', 'pipe:1'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.int16)

def fetch(repo, rev, name, dest, token=None):
    from huggingface_hub import hf_hub_download
    for i in range(6):
        try: return hf_hub_download(repo, name, repo_type='dataset', revision=rev, local_dir=dest, token=token)
        except Exception as e:
            if i == 5 or type(e).__name__ in ('GatedRepoError', 'EntryNotFoundError', 'RepositoryNotFoundError'): raise
            time.sleep(3 * (i + 1))

def windows_of(n, k):
    """Up to k 10 s windows spread across the song (start sample of each); a short song is one padded window."""
    w = SECS * RATE
    if n <= w: return [0]
    return sorted({int(round((n - w) * (j + 0.5) / k)) for j in range(k)})

def track(args, split, tr):
    """-> list of (item, int16 window) for one track, or [] when it cannot be read."""
    yaml = need('yaml', 'pyyaml'); dest = os.path.join(args.cache, tr); t_start = time.time()
    try:
        meta = yaml.safe_load(open(fetch(*META, f'{split}/{tr}/metadata.yaml', dest)))
        stems = {s: v for s, v in (meta.get('stems') or {}).items() if v.get('audio_rendered')}
        mix = decode(fetch(*MIX, f'data/{split}/{tr}/mix.flac', dest))
        labels = {s: stem_labels(v) for s, v in stems.items()}
        audio, spans = {}, {}
        for s, v in stems.items():
            if args.source == 'stems': audio[s] = decode(fetch(*STEMS, f'{split}/{tr}/stems/{s}.flac', dest, token=args.token))
            else:
                try: spans[s] = note_spans(fetch(*META, f'{split}/{tr}/MIDI/{s}.mid', dest)) if v.get('midi_saved', True) else None
                except Exception: spans[s] = None
        out = []
        for a in windows_of(len(mix), args.windows):
            x = mix[a:a + SECS * RATE]; x = np.pad(x, (0, SECS * RATE - len(x)))
            if rms_db(x) < -50: continue                                     # a near-silent stretch of the mix
            if args.source == 'stems':
                st = {s: stem_status(np.pad(audio[s][a:a + SECS * RATE], (0, max(0, SECS * RATE - len(audio[s][a:a + SECS * RATE])))), x) for s in stems}
            else: st = {s: midi_status(spans[s], a / RATE, bool(stems[s].get('is_drum'))) for s in stems}
            out.append(({'id': f'slakh:{tr}@{a / RATE:.1f}', 'artist': f'slakh:{tr}', 'val': SPLITS[split],
                         'labels': window_labels(st, labels), 'weakAbsent': []}, x))
        return out, time.time() - t_start
    except Exception as e:
        print(f'  skip {split}/{tr}: {type(e).__name__}: {e}', flush=True); return [], time.time() - t_start
    finally: shutil.rmtree(dest, ignore_errors=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--tracks', type=int, default=600); ap.add_argument('--val-tracks', type=int, default=100)
    ap.add_argument('--windows', type=int, default=4); ap.add_argument('--limit', type=int, default=0); ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--source', choices=['midi', 'stems'], default='midi')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    args.cache = os.path.join(args.out, 'slakh-download'); args.token = os.environ.get('HF_TOKEN') or None
    from huggingface_hub import list_repo_files
    files = list_repo_files(MIX[0], repo_type='dataset', revision=MIX[1])
    split_tracks = {sp: sorted({f.split('/')[2] for f in files if f.startswith(f'data/{sp}/') and f.endswith('/mix.flac')}, key=lambda t: h('dge-slakh', t))
                    for sp in SPLITS}
    n_train, n_val = (args.limit, max(1, args.limit // 6)) if args.limit else (args.tracks, args.val_tracks)
    jobs = [('train', t) for t in split_tracks['train'][:n_train]] + [('validation', t) for t in split_tracks['validation'][:n_val]]
    print(f'{len(jobs)} Slakh tracks ({n_train} train of {len(split_tracks["train"])}, {len(jobs) - min(n_train, len(split_tracks["train"]))} validation), '
          f'{args.windows} windows each, presence from {args.source}; {len(TAUGHT)} labels', flush=True)

    import torch
    sys.path.insert(0, os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT')))
    from models.preprocess import AugmentMelSTFT
    mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320, n_fft=1024, freqm=0, timem=0, fmin=0, fmax=None).eval()
    raw_path = os.path.join(args.out, 'slakh-mel.raw'); raw = open(raw_path, 'wb'); items, batch, secs = [], [], []
    def flush():
        with torch.no_grad(): m = mel(torch.from_numpy(np.stack([x for _, x in batch]).astype(np.float32) / 32768))[:, :, :1000].numpy().astype(np.float16)
        for (it, _), v in zip(batch, m):
            raw.write(v.tobytes()); it['row'] = len(items); items.append(it)
        batch.clear()
    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as pool:
        for k, (got, s) in enumerate(pool.map(lambda j: track(args, *j), jobs)):
            secs.append(s)
            for it, x in got:
                batch.append((it, x))
                if len(batch) == 64: flush()
            if k % 50 == 0: print(f'  track {k}/{len(jobs)}  {len(items) + len(batch)} windows  {time.time() - t0:.0f} s', flush=True)
    if batch: flush()
    raw.close(); shutil.rmtree(args.cache, ignore_errors=True)
    src = np.memmap(raw_path, dtype=np.float16, mode='r', shape=(len(items), 128, 1000))
    dst = np.lib.format.open_memmap(os.path.join(args.out, 'slakh-mel.npy'), mode='w+', dtype=np.float16, shape=src.shape)
    for k in range(0, len(items), 2048): dst[k:k + 2048] = src[k:k + 2048]
    dst.flush(); del dst, src; os.remove(raw_path)
    json.dump({'source': f'Slakh2100 redux (Manilow et al. 2019, Zenodo 4599666, CC BY 4.0): mixes hf://datasets/{MIX[0]}@{MIX[1][:7]}, '
                         f'metadata and MIDI hf://datasets/{META[0]}@{META[1][:7]}' + (f', stems hf://datasets/{STEMS[0]}@{STEMS[1][:7]}' if args.source == 'stems' else '')
                         + f'; presence from {args.source}', 'items': items}, open(os.path.join(args.out, 'slakh.json'), 'w'))
    pos, known = defaultdict(int), defaultdict(int)
    for it in items:
        for c, v in it['labels'].items(): pos[c[4:]] += v; known[c[4:]] += 1
    nval = sum(it['val'] for it in items)
    print(f'slakh: {len(items)} windows ({nval} validation) from {len({it["artist"] for it in items})} tracks in {time.time() - t0:.0f} s '
          f'({np.mean(secs) if secs else 0:.1f} s per track per worker); positives/known ' +
          ', '.join(f'{l} {int(pos[l])}/{known[l]}' for l in sorted(TAUGHT, key=lambda l: (pos[l], l))), flush=True)

if __name__ == '__main__':
    main()
