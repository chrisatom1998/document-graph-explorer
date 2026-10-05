"""Freeze a short-clip (0.3-2.25 s) one-shot benchmark before any tuning.

Sources, all local and licence-recorded:
  * FSD50K eval split (human-verified AudioSet labels; uploaders disjoint from FSD50K dev).
    Natural durations, audio unchanged. Uploaders already used for DGE training are excluded.
  * FSD50K dev, regrouped by uploader into calibration / train (never test).
  * NSynth test (calibration from NSynth valid): first 1.0 or 2.0 s of a note, 10 ms fade-out.
    Pitch and instrument family come from NSynth metadata, never from file names.
  * AVP vocal percussion: one cropped utterance per annotated onset. Imitated kick/snare/hat
    stay UNKNOWN for those roles; they are voice and beatbox.

A label that no source states is unreviewed (unknown), never absent.
Output audio uses opaque names so DGE's filename fallback cannot leak labels.

Usage: python3 scripts/build-short-clip-bench.py   (idempotent; refuses to overwrite a frozen test split)
"""
import csv, hashlib, io, json, os, random, subprocess, sys, wave, zipfile, tarfile, datetime
from collections import Counter, defaultdict

MEDIA = '/Users/chrisjohnson/Documents/Media'
W = f'{MEDIA}/dj-training-fingerprints/short-clips'
DATA = f'{MEDIA}/audio-datasets'
AUDIO = f'{W}/bench-audio'
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'evaluations', 'short-clips-2026-10-04')
NOW = '2026-10-04T23:30:00Z'
MIN_S, MAX_S = 0.3, 2.25
PER_UPLOADER = {'test': 8, 'calibration': 8, 'train': 30}   # caps correlated clips from one uploader per split
os.makedirs(AUDIO, exist_ok=True); os.makedirs(f'{W}/train-audio', exist_ok=True); os.makedirs(OUT, exist_ok=True)

def h(*parts):
    return hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest()

# ---- Category rules over FSD50K labels -------------------------------------------------
PERC_LEAVES = {'Bass_drum', 'Snare_drum', 'Hi-hat', 'Cymbal', 'Crash_cymbal', 'Tambourine', 'Cowbell', 'Rattle_(instrument)',
               'Gong', 'Tabla', 'Mallet_percussion', 'Marimba_and_xylophone', 'Glockenspiel', 'Drum_kit', 'Drum'}
VOICE = {'Human_voice', 'Speech', 'Singing', 'Shout', 'Yell', 'Screaming', 'Whispering', 'Laughter', 'Giggle',
         'Male_speech_and_man_speaking', 'Female_speech_and_woman_speaking', 'Child_speech_and_kid_speaking',
         'Male_singing', 'Female_singing', 'Chuckle_and_chortle', 'Gasp', 'Sigh', 'Crying_and_sobbing'}
BODY = {'Burping_and_eructation', 'Fart', 'Cough', 'Sneeze', 'Breathing', 'Respiratory_sounds', 'Hands', 'Chewing_and_mastication'}
IMPACTISH = {'Thump_and_thud', 'Explosion', 'Boom', 'Slam', 'Knock', 'Crash', 'Gunshot_and_gunfire', 'Hammer', 'Crack', 'Shatter',
             'Door', 'Wood', 'Glass', 'Fireworks', 'Thunder', 'Crushing', 'Chink_and_clink', 'Dishes_and_pots_and_pans', 'Tap'}
INSTR = {'Guitar', 'Electric_guitar', 'Acoustic_guitar', 'Bass_guitar', 'Piano', 'Keyboard_(musical)', 'Organ', 'Synthesizer',
         'Brass_instrument', 'Trumpet', 'Bowed_string_instrument', 'Wind_instrument_and_woodwind_instrument', 'Harmonica',
         'Plucked_string_instrument', 'Strum', 'Bell', 'Glockenspiel', 'Mallet_percussion', 'Marimba_and_xylophone'}

def informative(L):
    """Clip carries a specific leaf label, so absence of other leaves is meaningful."""
    return bool(L - {'Music', 'Musical_instrument', 'Percussion', 'Domestic_sounds_and_home_sounds', 'Human_group_actions',
                     'Mechanisms', 'Tools', 'Vehicle', 'Animal', 'Liquid', 'Water'})

def rule(pos, amb=frozenset(), need_informative=True):
    def f(L):
        if L & pos: return 'present'
        if L & amb or (need_informative and not informative(L)): return None
        return 'absent'
    return f

def generic_perc(L):
    return 'Percussion' in L and not (L & (PERC_LEAVES - {'Drum'}))

def drum_amb(L):
    return {'Drum'} if ('Drum' in L and not L & {'Bass_drum', 'Snare_drum', 'Tabla'}) else set()

FSD_RULES = {
    ('role', 'kick'): lambda L: rule({'Bass_drum'}, {'Drum_kit', 'Thump_and_thud', 'Boom', 'Explosion'} | drum_amb(L))(L) if not generic_perc(L) else (None if 'Bass_drum' not in L else 'present'),
    ('role', 'snare'): lambda L: rule({'Snare_drum'}, {'Drum_kit', 'Clapping', 'Crack', 'Gunshot_and_gunfire'} | drum_amb(L))(L) if not generic_perc(L) else (None if 'Snare_drum' not in L else 'present'),
    ('role', 'hi-hat'): lambda L: rule({'Hi-hat'}, {'Drum_kit', 'Cymbal', 'Crash_cymbal', 'Tambourine', 'Rattle_(instrument)', 'Hiss'})(L) if not generic_perc(L) else (None if 'Hi-hat' not in L else 'present'),
    ('role', 'cymbal'): lambda L: rule({'Cymbal', 'Crash_cymbal'} - set(), {'Drum_kit', 'Gong', 'Bell', 'Tambourine'})(L - ({'Cymbal'} if 'Hi-hat' in L else set())) if not generic_perc(L) else (None if not L & {'Crash_cymbal'} else 'present'),
    ('role', 'clap'): rule({'Clapping'}, {'Applause', 'Hands', 'Finger_snapping', 'Slam', 'Crack', 'Snare_drum', 'Human_group_actions'}),
    ('role', 'finger snap'): rule({'Finger_snapping'}, {'Hands', 'Clapping', 'Tick', 'Crack'}),
    ('role', 'tambourine'): rule({'Tambourine'}, {'Rattle_(instrument)', 'Cymbal', 'Hi-hat', 'Drum_kit', 'Keys_jangling'}),
    ('role', 'cowbell'): rule({'Cowbell'}, {'Bell', 'Mallet_percussion', 'Chink_and_clink', 'Drum_kit'}),
    ('role', 'shaker'): rule({'Rattle_(instrument)'}, {'Rattle', 'Tambourine', 'Hi-hat', 'Drum_kit'}),
    ('role', 'percussion hit'): lambda L: 'present' if L & PERC_LEAVES - {'Drum_kit'} else (None if L & (IMPACTISH | {'Percussion', 'Drum_kit', 'Clapping', 'Finger_snapping', 'Hands', 'Tick', 'Bell', 'Chime', 'Typing', 'Typewriter', 'Ratchet_and_pawl', 'Scratching_(performance_technique)'}) or not informative(L) else 'absent'),
    ('role', 'whoosh'): rule({'Whoosh_and_swoosh_and_swish'}, {'Wind', 'Car_passing_by', 'Hiss', 'Aircraft', 'Vehicle', 'Bicycle', 'Skateboard', 'Swoosh'}),
    ('role', 'impact'): rule({'Explosion', 'Thump_and_thud', 'Boom'}, IMPACTISH | {'Bass_drum', 'Drum', 'Drum_kit', 'Snare_drum', 'Gong', 'Fireworks', 'Cymbal', 'Crash_cymbal'}),
    ('role', 'vinyl scratch'): rule({'Scratching_(performance_technique)'}, {'Squeak', 'Screech', 'Tearing', 'Zipper_(clothing)', 'Ratchet_and_pawl', 'Scratching'}),
    ('role', 'vocal one-shot'): rule(VOICE, BODY | {'Speech_synthesizer', 'Crowd', 'Chatter', 'Cheering', 'Conversation'}),
    ('role', 'bass hit'): rule({'Bass_guitar'}, {'Guitar', 'Plucked_string_instrument', 'Synthesizer', 'Bass_drum', 'Electric_guitar', 'Keyboard_(musical)', 'Boom'}),
    ('source', 'voice'): rule(VOICE, BODY | {'Speech_synthesizer', 'Crowd', 'Chatter', 'Cheering', 'Conversation'}),
    ('source', 'drums'): lambda L: 'present' if L & (PERC_LEAVES - {'Mallet_percussion', 'Marimba_and_xylophone', 'Glockenspiel', 'Gong'}) else (None if L & (IMPACTISH | {'Percussion', 'Clapping', 'Finger_snapping', 'Mallet_percussion', 'Gong', 'Bell', 'Hands', 'Tick', 'Scratching_(performance_technique)'}) or not informative(L) else 'absent'),
    ('source', 'guitar'): rule({'Guitar', 'Electric_guitar', 'Acoustic_guitar'}, {'Plucked_string_instrument', 'Bass_guitar', 'Strum'}),
    ('source', 'bass guitar'): rule({'Bass_guitar'}, {'Guitar', 'Plucked_string_instrument', 'Electric_guitar'}),
    ('source', 'piano'): rule({'Piano'}, {'Keyboard_(musical)', 'Organ', 'Synthesizer'}),
    ('source', 'synthesizer'): rule({'Synthesizer'}, {'Keyboard_(musical)', 'Speech_synthesizer', 'Organ', 'Electronic_music', 'Ringtone', 'Alarm', 'Beep', 'Buzz'}),
    ('source', 'brass'): rule({'Brass_instrument', 'Trumpet'}, {'Wind_instrument_and_woodwind_instrument', 'Vehicle_horn_and_car_horn_and_honking', 'Harmonica'}),
}
# Loop-type tags are wrong on a single event; only sources that guarantee one event can say so.
LOOP = ('role', 'loop')

def nsynth_truth(meta, seconds):
    fam, src, q = meta['instrument_family_str'], meta['instrument_source_str'], set(meta['qualities_str'])
    t = {}
    for cat, fn in FSD_RULES.items(): t[cat] = 'absent'          # every NSynth note is a single pitched instrument note
    for cat in [('role', 'percussion hit'), ('source', 'drums')]: t[cat] = None if fam == 'mallet' else 'absent'
    t[('role', 'vocal one-shot')] = t[('source', 'voice')] = 'present' if fam == 'vocal' else 'absent'
    if fam == 'vocal' and src != 'acoustic': t[('role', 'vocal one-shot')] = t[('source', 'voice')] = None
    t[('role', 'bass hit')] = 'present' if fam == 'bass' else ('absent' if fam not in ('keyboard', 'synth_lead', 'guitar') else None)
    t[('role', 'synth hit')] = 'present' if src == 'synthetic' and fam in ('synth_lead', 'keyboard', 'bass') else ('absent' if src == 'acoustic' else None)
    t[('source', 'synthesizer')] = 'present' if src == 'synthetic' else ('absent' if src == 'acoustic' else None)
    t[('source', 'guitar')] = 'present' if fam == 'guitar' and src == 'acoustic' else ('absent' if src == 'acoustic' or fam not in ('guitar',) else None)
    t[('source', 'bass guitar')] = 'present' if fam == 'bass' and src == 'acoustic' else ('absent' if fam != 'bass' and src == 'acoustic' else None)
    t[('source', 'piano')] = 'present' if fam == 'keyboard' and src == 'acoustic' else ('absent' if src == 'acoustic' else None)
    t[('source', 'brass')] = 'present' if fam == 'brass' and src == 'acoustic' else ('absent' if src == 'acoustic' else None)
    t[('role', 'impact')] = t[('role', 'whoosh')] = 'absent'
    t[('effect', 'distorted')] = 'present' if 'distortion' in q else 'absent'
    t[('effect', 'reverberant')] = 'present' if 'reverb' in q else 'absent'
    t[LOOP] = 'absent'
    t[('musical', 'key')] = 'absent'      # one note has a pitch, not a major/minor key
    t[('musical', 'tempo')] = 'absent'
    return {k: v for k, v in t.items() if v}

def avp_truth():
    t = {k: 'absent' for k in FSD_RULES}
    for k in [('role', 'kick'), ('role', 'snare'), ('role', 'hi-hat'), ('role', 'percussion hit'), ('role', 'cymbal')]: t[k] = None  # imitation: unknown
    t[('role', 'vocal one-shot')] = t[('source', 'voice')] = 'present'
    t[('role', 'beatbox')] = 'present'; t[('source', 'drums')] = 'absent'; t[('role', 'synth hit')] = 'absent'
    t[LOOP] = 'absent'; t[('musical', 'key')] = 'absent'; t[('musical', 'tempo')] = 'absent'
    return {k: v for k, v in t.items() if v}

# ---- Audio helpers ------------------------------------------------------------------------------
def wav_info(b):
    with wave.open(io.BytesIO(b)) as w:
        n, r, c, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
        frames = w.readframes(n)
    import array
    a = array.array('h', frames) if sw == 2 else None
    peak = max((abs(x) for x in a), default=0) / 32768 if a is not None else None
    return n / r, peak

def write_opaque(item_id, data):
    path = f'{AUDIO}/{item_id}.wav'
    if not os.path.exists(path):
        with open(path, 'wb') as f: f.write(data)
    return path

def ffmpeg_crop(src_bytes, start, dur, fade=0.01):
    p = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-ss', f'{start:.4f}', '-t', f'{dur:.4f}',
                        '-af', f'afade=t=out:st={max(0, dur - fade):.4f}:d={fade}', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'],
                       input=src_bytes, capture_output=True, check=True)
    return p.stdout

# ---- Build -----------------------------------------------------------------------------------------
items, train = [], []
def add(item, truth, split, extra):
    item['reviews'] = [{'reviewer': extra['reviewer'], 'at': extra['reviewedAt'], 'dimension': d, 'label': l, 'state': s}
                       for (d, l), s in sorted(truth.items())]
    item.update(split=split, tier='one-shot')
    (train if split == 'train' else items).append(item)

meta_dir = f'{W}/fsd50k-meta'
trained = json.load(open(f'{MEDIA}/dj-training-sounds/index.json'))['items']
used_users = {i['username'] for i in trained}; used_ids = {str(i['id']) for i in trained}
fsld = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'artifacts/astra90/dataset-research/fsld-short-dj-references-v1/reference-manifest.json')))['records']
used_users |= {r['originalProvenance']['creatorName'] for r in fsld}; used_ids |= {r['id'] for r in fsld}
stats = Counter()
for part, zipname, csvname, infoname in [('eval', 'eval_merged.zip', 'eval.csv', 'eval_clips_info_FSD50K.json'),
                                          ('dev', 'dev_merged.zip', 'dev.csv', 'dev_clips_info_FSD50K.json')]:
    labels = {r['fname']: set(r['labels'].split(',')) for r in csv.DictReader(open(f'{meta_dir}/FSD50K.ground_truth/{csvname}'))}
    info = json.load(open(f'{meta_dir}/FSD50K.metadata/{infoname}'))
    z = zipfile.ZipFile(f'{W}/{zipname}')
    per_up = Counter()
    entries = sorted((i for i in z.infolist() if i.filename.endswith('.wav')), key=lambda i: h('order', i.filename))
    for zi in entries:
        fid = zi.filename.split('/')[-1][:-4]
        approx = (zi.file_size - 44) / 88200
        if not (MIN_S - .05 <= approx <= MAX_S + .05): continue
        meta = info[fid]; up = meta['uploader']
        if part == 'eval':
            if up in used_users or fid in used_ids: stats['eval excluded: uploader/id used in DGE training'] += 1; continue
            split = 'test'
        else:
            split = 'calibration' if int(h('fsd-up', up)[:8], 16) % 5 == 0 and up not in used_users else 'train'
        L = labels[fid]
        truth = {cat: s for cat, fn in FSD_RULES.items() if (s := fn(L))}
        if not any(s == 'present' for s in truth.values()) and split != 'train':
            # Keep a bounded sample of pure confusers (doors, glass, animals...) as negatives.
            if int(h('confuser', fid)[:8], 16) % 3: continue
        if per_up[(split, up)] >= PER_UPLOADER[split]: stats[f'{split} capped per uploader'] += 1; continue
        data = z.read(zi)
        dur, peak = wav_info(data)
        if not (MIN_S <= dur <= MAX_S): continue
        per_up[(split, up)] += 1
        iid = 'sc-' + h('fsd50k', fid)[:16]
        item = {'id': iid, 'source': f'FSD50K {part} clip {fid}: https://freesound.org/s/{fid}/ ({meta["license"]}, uploader {up})',
                'rights': {'evaluationAllowed': True, 'basis': f'FSD50K (CC BY 4.0 compilation, Zenodo 4060432); clip licence {meta["license"]}'},
                'groups': {'original': f'freesound:{fid}', 'artist': f'freesound-user:{up}', 'pack': f'freesound-user:{up}', 'sampleFamily': f'freesound-user:{up}'},
                'transformations': [], 'start': 0, 'end': round(dur, 4),
                'meta': {'dataset': 'fsd50k', 'durationSeconds': round(dur, 4), 'peak': peak, 'quiet': bool(peak is not None and peak < 0.1),
                         'licence': meta['license'], 'fsdLabels': sorted(L), 'audio': f'{iid}.wav'}}
        if split != 'train': write_opaque(iid, data)
        else:
            item['meta']['zipMember'] = zi.filename
            tp = f'{W}/train-audio/{iid}.wav'
            if not os.path.exists(tp): open(tp, 'wb').write(data)
        add(item, truth, split, {'reviewer': 'FSD50K human annotators (dataset ground truth, mapped by scripts/build-short-clip-bench.py)', 'reviewedAt': '2020-10-02T00:00:00Z'})
        stats[f'{split} fsd50k'] += 1

# NSynth test only (valid shares instruments with test). Instruments split 2:1 test:calibration by hash.
for tarname in ['nsynth-test.jsonwav.tar.gz']:
    root = tarname.split('.')[0]
    ex_path = f'{W}/{root}/examples.json'
    tf = tarfile.open(f'{DATA}/nsynth/{tarname}')
    if not os.path.exists(ex_path): tf.extract(f'{root}/examples.json', W)
    ex = json.load(open(ex_path))
    per_inst = Counter(); chosen = []
    for name in sorted(ex, key=lambda n: h('nsynth', n)):
        m = ex[name]
        if not 36 <= m['pitch'] <= 84 or m['velocity'] < 50 or per_inst[m['instrument_str']] >= 6: continue
        per_inst[m['instrument_str']] += 1; chosen.append(name)
    wanted = {f'{root}/audio/{n}.wav': n for n in chosen}
    for member in tf:
        n = wanted.get(member.name)
        if not n: continue
        m = ex[n]; split = 'calibration' if int(h('nsynth-inst', m['instrument_str'])[:8], 16) % 3 == 0 else 'test'
        secs = 1.0 if int(h('len', n)[:8], 16) % 2 else 2.0
        iid = 'sc-' + h('nsynth', n)[:16]
        data = ffmpeg_crop(tf.extractfile(member).read(), 0, secs)
        write_opaque(iid, data)
        _, peak = wav_info(data)
        item = {'id': iid, 'source': f'NSynth {root} note {n} (CC BY 4.0, Google Magenta)',
                'rights': {'evaluationAllowed': True, 'basis': 'NSynth dataset, CC BY 4.0 (magenta.tensorflow.org/datasets/nsynth)'},
                'groups': {'original': f'nsynth:{m["instrument_str"]}', 'artist': f'nsynth:{m["instrument_str"]}', 'pack': f'nsynth:{m["instrument_str"]}', 'sampleFamily': f'nsynth:{m["instrument_str"]}'},
                'transformations': [f'first {secs:.1f} s of the 4 s note, 10 ms linear fade-out, 16 kHz mono'], 'start': 0, 'end': secs,
                'meta': {'dataset': 'nsynth', 'durationSeconds': secs, 'peak': peak, 'quiet': bool(peak is not None and peak < 0.1), 'midiPitch': m['pitch'], 'pitchClass': m['pitch'] % 12,
                         'family': m['instrument_family_str'], 'instrumentSource': m['instrument_source_str'], 'qualities': m['qualities_str'], 'audio': f'{iid}.wav'}}
        add(item, nsynth_truth(m, secs), split, {'reviewer': 'NSynth metadata (instrument family/source; qualities annotated by NSynth authors)', 'reviewedAt': '2017-04-05T00:00:00Z'})
        stats[f'{split} nsynth'] += 1

# AVP Personal subset: participants split by hash.
z = zipfile.ZipFile(f'{DATA}/avp-vocal-percussion/AVP_Dataset.zip')
names = set(z.namelist())
for csvn in sorted(n for n in names if n.startswith('AVP_Dataset/Personal/') and n.endswith('_Personal.csv') and 'Improvisation' not in n and '__MACOSX' not in n):
    participant = csvn.split('/')[2]
    bucket = int(h('avp', participant)[:8], 16) % 4
    split = 'test' if bucket < 2 else 'calibration' if bucket == 2 else 'train'
    wavn = csvn[:-4] + '.wav'
    if wavn not in names: continue
    onsets = [float(r[0]) for r in csv.reader(io.StringIO(z.read(csvn).decode())) if r]
    src = z.read(wavn)
    total, _ = wav_info(src)
    picks = sorted(range(len(onsets)), key=lambda i: h('avp-pick', csvn, i))[:3]
    for i in picks:
        start = max(0, onsets[i] - .01)
        end = min(total, onsets[i + 1] - .02 if i + 1 < len(onsets) else total, start + 1.0)
        if end - start < MIN_S: continue
        iid = 'sc-' + h('avp', csvn, i)[:16]
        item = {'id': iid, 'source': f'AVP {wavn} onset {onsets[i]:.3f}s (CC BY 4.0, Delgado et al., Zenodo 3245959)',
                'rights': {'evaluationAllowed': True, 'basis': 'Amateur Vocal Percussion dataset, CC BY 4.0'},
                'groups': {'original': f'avp:{wavn}', 'artist': f'avp:{participant}', 'pack': f'avp:{participant}', 'sampleFamily': f'avp:{participant}'},
                'transformations': [f'crop {start:.3f}-{end:.3f} s at an annotated onset, 10 ms fade-out'], 'start': round(start, 4), 'end': round(end, 4),
                'meta': {'dataset': 'avp', 'durationSeconds': round(end - start, 4), 'imitates': csvn.split('_')[-2], 'participant': participant}}
        data = ffmpeg_crop(src, start, end - start)
        if split == 'train': open(f'{W}/train-audio/{iid}.wav', 'wb').write(data)
        if split != 'train':
            write_opaque(iid, data)
            item['meta']['peak'] = wav_info(data)[1]; item['meta']['quiet'] = item['meta']['peak'] < 0.1; item['meta']['audio'] = f'{iid}.wav'
        add(item, avp_truth(), split, {'reviewer': 'AVP onset annotations (Delgado et al.)', 'reviewedAt': '2019-06-14T00:00:00Z'})
        stats[f'{split} avp'] += 1

manifest_path = f'{OUT}/manifest.json'
manifest = {'version': 1, 'frozenAt': NOW, 'items': [{k: v for k, v in i.items() if k != 'meta'} for i in items]}
if os.path.exists(manifest_path):
    old = json.load(open(manifest_path))
    if [i for i in old['items'] if i['split'] == 'test'] != [i for i in manifest['items'] if i['split'] == 'test']:
        sys.exit('Refusing to change a frozen test split; write a new dated benchmark instead.')
json.dump(manifest, open(manifest_path, 'w'), indent=1)
json.dump({i['id']: i['meta'] for i in items}, open(f'{OUT}/item-meta.json', 'w'), indent=1)
json.dump({'items': [{'id': i['id'], 'groups': i['groups'], 'reviews': i['reviews'], 'meta': i['meta']} for i in train]}, open(f'{W}/train-items.json', 'w'))
cats = Counter((i['split'], r['dimension'], r['label'], r['state']) for i in items + train for r in i['reviews'])
summary = {'frozenAt': NOW, 'counts': dict(stats), 'labels': {f'{s}/{d}:{l}': {st: cats[(s, d, l, st)] for st in ('present', 'absent')}
                                                              for (s, d, l, _) in sorted(set(k for k in cats))},
           'families': {s: len({i['groups']['artist'] for i in items + train if i['split'] == s}) for s in ('test', 'calibration', 'train')},
           'manifestSha256': hashlib.sha256(open(manifest_path, 'rb').read()).hexdigest()}
json.dump(summary, open(f'{OUT}/summary.json', 'w'), indent=1)
print(json.dumps(summary['counts'], indent=1), summary['families'])
