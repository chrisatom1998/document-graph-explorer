"""Build the training pool (never touches the frozen test split) in train-items.json format.

Sources (licences recorded per item):
  FSD50K dev clips, CC0 / CC BY only, uploaders disjoint from calibration and test   (labels: FSD_RULES)
  NSynth TRAIN notes (instruments disjoint from NSynth test), first 1.0/2.0 s       (labels: nsynth_truth)
  AVP participants in the benchmark's train bucket only                              (labels: avp_truth)
  EGFxSet clean / distortion / reverb guitar notes, first 1.0/2.0 s                 (labels: guitar + effect)
"""
import json, os, re, io, csv, hashlib, zipfile, subprocess, collections, sys
SRC = open('/home/user/document-graph-explorer/scripts/build-short-clip-bench.py').read()
exec(SRC[:SRC.index('# ---- Audio helpers')])          # FSD_RULES, nsynth_truth, avp_truth, h, LOOP
W = '/home/user/media/dj-training-fingerprints/short-clips'; TA = f'{W}/train-audio'; os.makedirs(TA, exist_ok=True)
D = '/home/user/data'
R = '/home/user/document-graph-explorer/docs/evaluations/short-clips-2026-10-04'
reserved = json.load(open(f'{R}/reserved-test-families.json'))
RS_ID, RS_UP, RS_NS, RS_AVP = set(reserved['freesoundIds']), set(reserved['freesoundUploaders']), set(reserved['nsynthInstruments']), set(reserved['avpParticipants'])
def crop(b, start, dur, fade=0.01, rate=None):
    a = ['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-ss', f'{start:.4f}', '-t', f'{dur:.4f}', '-af', f'afade=t=out:st={max(0, dur - fade):.4f}:d={fade}', '-ac', '1']
    return subprocess.run(a + (['-ar', str(rate)] if rate else []) + ['-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], input=b, capture_output=True, check=True).stdout
items = []; stats = collections.Counter()
def add(iid, truth, groups, meta, reviewer, at):
    items.append({'id': iid, 'groups': groups, 'meta': meta,
                  'reviews': [{'reviewer': reviewer, 'at': at, 'dimension': d, 'label': l, 'state': s} for (d, l), s in sorted(truth.items()) if s]})
    stats[meta['dataset']] += 1

# FSD50K dev
info = json.load(open(f'{D}/fsd50k-meta/FSD50K.metadata/dev_clips_info_FSD50K.json'))
labels = {r['fname']: set(r['labels'].split(',')) for r in csv.DictReader(open(f'{D}/fsd50k-meta/FSD50K.ground_truth/dev.csv'))}
plan = json.load(open('/home/user/work/fsd-plan.json'))
for name in plan['train']:
    fid = name[:-4]; p = f'{D}/fsd-dev/{name}'
    if not os.path.exists(p): stats['fsd missing'] += 1; continue
    iid = 'tr-' + h('fsd50k', fid)[:16]
    assert fid not in RS_ID and info[fid]['uploader'] not in RS_UP, fid
    dest = f'{TA}/{iid}.wav'
    if not os.path.exists(dest): os.link(p, dest)
    L = labels[fid]; truth = {c: fn(L) for c, fn in FSD_RULES.items()}
    truth[('role', 'beatbox')] = 'absent'   # FSD50K has no beatboxing class; used only as training negatives
    up = info[fid]['uploader']
    add(iid, truth, {'original': f'freesound:{fid}', 'artist': f'freesound-user:{up}', 'pack': f'freesound-user:{up}', 'sampleFamily': f'freesound-user:{up}'},
        {'dataset': 'fsd50k', 'licence': info[fid]['license'], 'fsdLabels': sorted(L)}, 'FSD50K annotators via FSD_RULES', '2020-10-02T00:00:00Z')

# NSynth train
ex = json.load(open(f'{D}/nsynth-train/examples.json'))
for f in sorted(os.listdir(f'{D}/nsynth-train')):
    if not f.endswith('.wav'): continue
    n = f[:-4]; m = ex[n]; secs = 1.0 if int(h('len', n)[:8], 16) % 2 else 2.0
    assert m['instrument_str'] not in RS_NS, n
    iid = 'tr-' + h('nsynth-train', n)[:16]; dest = f'{TA}/{iid}.wav'
    if not os.path.exists(dest): open(dest, 'wb').write(crop(open(f'{D}/nsynth-train/{f}', 'rb').read(), 0, secs))
    g = f'nsynth:{m["instrument_str"]}'
    add(iid, nsynth_truth(m, secs), {'original': g, 'artist': g, 'pack': g, 'sampleFamily': g},
        {'dataset': 'nsynth-train', 'licence': 'CC BY 4.0', 'family': m['instrument_family_str'], 'instrumentSource': m['instrument_source_str'], 'qualities': m['qualities_str']},
        'NSynth metadata', '2017-04-05T00:00:00Z')

# AVP train participants (benchmark bucket 3 only), every annotated onset up to 12 per file
z = zipfile.ZipFile(f'{D}/avp.zip'); names = set(z.namelist())
for csvn in sorted(n for n in names if n.startswith('AVP_Dataset/Personal/') and n.endswith('_Personal.csv') and 'Improvisation' not in n and '__MACOSX' not in n):
    participant = csvn.split('/')[2]
    if int(h('avp', participant)[:8], 16) % 4 != 3: continue
    assert participant not in RS_AVP, participant
    wavn = csvn[:-4] + '.wav'
    if wavn not in names: continue
    onsets = [float(r[0]) for r in csv.reader(io.StringIO(z.read(csvn).decode())) if r]
    src = z.read(wavn); total = wav_dur = None
    import wave; w = wave.open(io.BytesIO(src)); total = w.getnframes() / w.getframerate()
    for i in sorted(range(len(onsets)), key=lambda i: h('avp-train', csvn, i))[:12]:
        start = max(0, onsets[i] - .01); end = min(total, onsets[i + 1] - .02 if i + 1 < len(onsets) else total, start + 1.0)
        if end - start < 0.3: continue
        iid = 'tr-' + h('avp', csvn, i)[:16]; dest = f'{TA}/{iid}.wav'
        if not os.path.exists(dest): open(dest, 'wb').write(crop(src, start, end - start))
        g = f'avp:{participant}'
        add(iid, avp_truth(), {'original': f'avp:{wavn}', 'artist': g, 'pack': g, 'sampleFamily': g},
            {'dataset': 'avp', 'licence': 'CC BY 4.0', 'imitates': csvn.split('_')[-2]}, 'AVP onset annotations', '2019-06-14T00:00:00Z')

# EGFxSet: same guitar note through different real pedals. Group = string-fret so a note never spans folds.
EFFECT = {'Clean': None, 'RAT': 'distorted', 'TubeScreamer': 'distorted', 'BluesDriver': 'distorted',
          'Hall-Reverb': 'reverberant', 'Plate-Reverb': 'reverberant', 'Spring-Reverb': 'reverberant'}
for fx, eff in EFFECT.items():
    zp = f'{D}/egfx/{fx}.zip'
    if not os.path.exists(zp): stats[f'egfx missing {fx}'] += 1; continue
    try: ez = zipfile.ZipFile(zp)
    except zipfile.BadZipFile: stats[f'egfx incomplete {fx}'] += 1; continue
    wavs = sorted((n for n in ez.namelist() if n.endswith('.wav')), key=lambda n: h('egfx', n))[:240]
    for n in wavs:
        note = os.path.basename(n)[:-4]; pickup = n.split('/')[1]
        secs = 1.0 if int(h('len', n)[:8], 16) % 2 else 2.0
        iid = 'tr-' + h('egfx', n)[:16]; dest = f'{TA}/{iid}.wav'
        if not os.path.exists(dest): open(dest, 'wb').write(crop(ez.read(n), 0, secs))
        t = nsynth_truth({'instrument_family_str': 'guitar', 'instrument_source_str': 'acoustic', 'qualities_str': []}, secs)
        t[('effect', 'distorted')] = 'present' if eff == 'distorted' else 'absent'
        t[('effect', 'reverberant')] = 'present' if eff == 'reverberant' else 'absent'
        t[('source', 'bass guitar')] = 'absent'
        g = f'egfx:{note}'
        add(iid, t, {'original': f'egfx:{note}:{pickup}', 'artist': g, 'pack': g, 'sampleFamily': g},
            {'dataset': 'egfxset', 'licence': 'CC BY 4.0', 'effect': fx, 'pickup': pickup}, 'EGFxSet effect metadata', '2022-09-02T00:00:00Z')

json.dump({'items': items}, open(f'{W}/train-items.json', 'w'))
print(dict(stats), len(items))
