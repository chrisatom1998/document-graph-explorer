"""Accepted and rejected audio manifests for the licensed-audio pilot.

Usage: python3 -I scripts/licensed-pilot/build_manifest.py <package-dir> <download-dir> <out-dir>
  <package-dir>   unpacked DGE-training-sound-discovery.zip (read as data only)
  <download-dir>  karoryfer/repo (git checkout at the pinned commit) and x/{kenney-impact,kenney-scifi,rubberduck100,rubberduck50}
                  (the archives in sources.json, unzipped)
Writes <out-dir>/accepted.csv, rejected.csv, summary.json.

Every accepted row carries original URL, creator, licence, source family, encoded and decoded-PCM checksums, duration,
labels per axis with their evidence, review status, fold group and split. Labels come from file names and are then
checked against the audio where a simple acoustic test exists (pitch for bass notes, a pitch sweep for lasers, a sharp
attack and decay for hits). Nothing here was listened to by a person: review status says "auto-checked", never
"listened". A name-derived positive that fails its check is kept as unknown, not as a positive.
Label states: 1 present, 0 absent (explicit, with evidence), blank unknown. Axes are separate columns so source, sound
type, synthesis method, articulation and effect never overwrite each other.
"""
import csv, hashlib, json, math, os, re, subprocess, sys
from collections import Counter
import numpy as np

PKG, DL, OUT = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = json.load(open(os.path.join(HERE, 'sources.json')))['accepted']
os.makedirs(OUT, exist_ok=True)
TARGETS = ['bass guitar', 'foley hit', 'laser']
EXCL = json.load(open(os.path.join(PKG, 'inventory/exclusion-manifest.json')))['sets']
EXCL_SHA = set(EXCL['audioSha256']) | set(EXCL['sourceAudioSha256'])
EXCL_MEMBERS = set(EXCL['sourceMembers'])
EXCL_UPLOADERS = set(EXCL['freesoundUploadersCasefold'])

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()

def decode(path, rate):
    # An undecodable file comes back empty and is rejected as "silent or undecodable" below.
    raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', str(rate), '-f', 's16le', '-'],
                         capture_output=True).stdout
    return raw, np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768

def frames(x, n=1024, hop=256):
    if len(x) < n: x = np.pad(x, (0, n - len(x)))
    k = 1 + (len(x) - n) // hop
    return np.stack([x[i * hop:i * hop + n] for i in range(k)])

def level_db(x, hop=256):
    f = frames(x, 512, hop); return 10 * np.log10((f ** 2).mean(1) + 1e-12)

def active(x):
    """Index range of frames within 40 dB of the loudest frame (hop 256)."""
    db = level_db(x); on = np.where(db > db.max() - 40)[0]
    return db, on[0], on[-1]

def sweep_octaves(x, sr):
    """Range (10th-90th percentile, octaves) of the strongest spectral peak over the loud frames."""
    f = frames(x) * np.hanning(1024); spec = np.abs(np.fft.rfft(f, axis=1))
    db = 20 * np.log10(spec.max(1) + 1e-9); keep = db > db.max() - 20
    freqs = np.fft.rfftfreq(1024, 1 / sr)[spec.argmax(1)][keep]
    freqs = freqs[freqs > 60]
    if len(freqs) < 4: return 0.0
    lo, hi = np.percentile(np.log2(freqs), [10, 90]); return float(hi - lo)

def f0_autocorr(x, sr):
    """Fundamental of the steady part of a plucked note (100-500 ms after the peak): YIN (cumulative mean normalised
    difference, first dip under 0.15), searched over 25-1200 Hz."""
    peak = int(np.argmax(np.abs(x))); seg = x[peak + int(0.1 * sr): peak + int(0.5 * sr)]
    lo, hi = int(sr / 1200), int(sr / 25)
    if len(seg) < 2 * hi: return None
    seg = seg - seg.mean(); w = len(seg) - hi
    d = np.array([np.sum((seg[:w] - seg[t:t + w]) ** 2) for t in range(hi)])
    cmnd = d[1:] * np.arange(1, hi) / np.maximum(np.cumsum(d[1:]), 1e-12)
    dips = np.where(cmnd[lo - 1:] < 0.15)[0]
    if not len(dips): return None
    t = dips[0] + lo - 1
    while t + 1 < len(cmnd) and cmnd[t + 1] < cmnd[t]: t += 1
    return sr / (t + 1)

NOTE = {'c': 0, 'db': 1, 'd': 2, 'eb': 3, 'e': 4, 'f': 5, 'gb': 6, 'g': 7, 'ab': 8, 'a': 9, 'bb': 10, 'b': 11}
def note_hz(name, octave): return 440 * 2 ** ((NOTE[name] + 12 * (octave + 1) - 69) / 12)

def checks(x, sr):
    db, a, b = active(x); hop = 256 / sr
    peak = int(np.argmax(db)); attack = (peak - a) * hop
    after = db[min(len(db) - 1, peak + int(0.3 / hop))]
    return {'active_s': round((b - a + 1) * hop, 3), 'attack_s': round(attack, 3), 'drop_300ms_db': round(float(db[peak] - after), 1),
            'sweep_oct': round(sweep_octaves(x, sr), 2)}

def row(family, member, path, url, labels, evidence, fold_group, auto=None):
    return {'family': family, 'member': member, 'path': path, 'url': url, 'labels': labels, 'evidence': evidence,
            'fold_group': fold_group, 'auto': auto or {}}

items = []
# Karoryfer Big Little Bass: one plucked bass note per file.
kd = os.path.join(DL, 'karoryfer/repo/Samples')
for fn in sorted(os.listdir(kd)):
    m = re.match(r'big_little_pluck_([a-g]b?)(\d)_([fp])_rr(\d)\.wav$', fn)
    if not m: continue
    items.append(row('karoryfer-big-little-bass', f'Samples/{fn}', os.path.join(kd, fn),
                     f'https://raw.githubusercontent.com/sfzinstruments/karoryfer.big-little-bass/4e92bdf54dcd2d6cfad968cc90542d5461c9b9fc/Samples/{fn}',
                     {'source': 'bass guitar', 'articulation': 'plucked', 'bass guitar': 1, 'foley hit': 0, 'laser': 0},
                     'pack and file name: one bass guitar note per file (Washburn AB95), note ' + m[1] + m[2],
                     f'karoryfer:{m[1]}{m[2]}', {'expect_hz': note_hz(m[1], int(m[2]))}))

def stem(fn): return re.sub(r'(_?\d+)?\.(ogg|wav)$', '', fn)

for fam_dir, family, url in [('kenney-impact/Audio', 'kenney', 'https://kenney.nl/assets/impact-sounds'),
                             ('kenney-scifi/Audio', 'kenney', 'https://kenney.nl/assets/sci-fi-sounds')]:
    d = os.path.join(DL, 'x', fam_dir)
    for fn in sorted(f for f in os.listdir(d) if f.endswith('.ogg')):
        s = stem(fn); lab = {'bass guitar': 0}
        if fam_dir.startswith('kenney-impact'):
            lab.update(source='foley', laser=0)
            if s.startswith('impact') and s != 'impactBell_heavy': lab.update({'foley hit': 1, 'sound type': 'object impact'}); ev = f'Kenney Impact Sounds file named {s}'
            else: ev = f'Kenney Impact Sounds file named {s}; footsteps and bell strikes left unknown for foley hit'
        else:
            lab['source'] = 'sound effect'
            if s.startswith('laser'): lab.update({'laser': 1, 'sound type': 'laser', 'synthesis': 'unknown (designed sci-fi sound)'}); ev = f'Kenney Sci-fi Sounds file named {s}'
            else:
                lab['laser'] = 0; ev = f'Kenney Sci-fi Sounds file named {s} (same-creator hard negative for laser)'
                if s in ('impactMetal', 'doorOpen', 'doorClose', 'slime'): ev += '; foley hit unknown'
                else: lab['foley hit'] = 0
        items.append(row(family, f'{fam_dir}/{fn}', os.path.join(d, fn), url, lab, ev, f'kenney:{s}'))

d = os.path.join(DL, 'x/rubberduck50')
for fn in sorted(f for f in os.listdir(d) if f.endswith('.ogg')):
    s = stem(fn); lab = {'bass guitar': 0, 'foley hit': 0, 'source': 'sound effect', 'synthesis': 'synthesized (LMMS/ZynAddSubFX, author statement)'}
    if s == 'synth_laser': lab.update({'laser': 1, 'sound type': 'laser'}); ev = f'rubberduck retro synth file named {s}'
    elif s in ('shot', 'power_up'): ev = f'rubberduck retro synth file named {s}: laser and rising left unknown (needs listening)'
    else: lab['laser'] = 0; ev = f'rubberduck retro synth file named {s} (same-creator hard negative for laser)'
    items.append(row('rubberduck', f'50-CC0-retro-synth-SFX/{fn}', os.path.join(d, fn), 'https://opengameart.org/node/87895', lab, ev, f'rubberduck:{s}'))

d = os.path.join(DL, 'x/rubberduck100')
for fn in sorted(f for f in os.listdir(d) if f.endswith('.ogg')):
    s = stem(fn).replace('sfx100v2_', ''); lab = {'bass guitar': 0, 'laser': 0}
    if s in ('hit', 'metal_hit', 'wood_hit'): lab.update({'foley hit': 1, 'source': 'foley', 'sound type': 'object impact'}); ev = f'rubberduck 100 SFX file named {s}'
    elif s.startswith('loop_') or s in ('thunder',): lab.update({'foley hit': 0, 'source': 'environmental sound'}); ev = f'rubberduck 100 SFX long recording named {s} (not a short hit)'
    else: ev = f'rubberduck 100 SFX file named {s}: object sound, foley hit left unknown'; lab['source'] = 'foley'
    items.append(row('rubberduck', f'sfx_100_v2/{fn}', os.path.join(d, fn), 'https://opengameart.org/content/100-cc0-sfx-2', lab, ev, f'rubberduck:{s}'))

accepted, rejected, seen_pcm = [], [], {}
for it in items:
    raw, x = decode(it['path'], 16000); enc = sha256(it['path']); pcm = hashlib.sha256(raw).hexdigest()
    dur = len(x) / 16000; c = checks(x, 16000) if len(x) else {}
    reasons = []
    if not len(x) or np.abs(x).max() < 1e-3: reasons.append('silent or undecodable')
    if enc in EXCL_SHA or pcm in EXCL_SHA: reasons.append('checksum in DGE exclusion manifest')
    if it['member'] in EXCL_MEMBERS: reasons.append('archive member in DGE exclusion manifest')
    if pcm in seen_pcm: reasons.append(f'decoded audio identical to {seen_pcm[pcm]}')
    lab, status = dict(it['labels']), 'auto-checked (not listened)'
    notes = []
    if lab.get('bass guitar') == 1:
        f0 = f0_autocorr(x, 16000); exp = it['auto']['expect_hz']
        cents = None if f0 is None else min(abs(1200 * math.log2(f0 / (exp * k))) for k in (0.5, 1, 2))
        c.update(f0_hz=None if f0 is None else round(f0, 1), expect_hz=round(exp, 1))
        if cents is None or cents > 100: lab['bass guitar'] = ''; status = 'name check failed: pitch does not match the note name'
        else: notes.append(f'pitch within {cents:.0f} cents of {exp:.0f} Hz (or its octave)')
    if lab.get('laser') == 1:
        if c['sweep_oct'] < 0.5 or c['active_s'] > 3: lab['laser'] = ''; status = 'name check failed: no pitch sweep of half an octave within 3 s'
        else: notes.append(f"pitch sweep {c['sweep_oct']} octaves in {c['active_s']} s")
    if lab.get('foley hit') == 1:
        if c['attack_s'] > 0.06 or c['drop_300ms_db'] < 6 or c['active_s'] > 4: lab['foley hit'] = ''; status = 'name check failed: not a sharp hit that decays'
        else: notes.append(f"attack {c['attack_s'] * 1000:.0f} ms, {c['drop_300ms_db']} dB down 300 ms after the peak")
    src = SOURCES[it['family']]
    rec = {'id': hashlib.sha256(f"{it['family']}|{it['member']}".encode()).hexdigest()[:16], 'family': it['family'], 'archive_member': it['member'],
           'original_url': it['url'], 'creator': src['creator'], 'license': src['license'], 'license_evidence': src['license_evidence'],
           'pin': src.get('pin', src['download']), 'encoded_sha256': enc, 'pcm16k_sha256': pcm, 'duration_s': round(dur, 3),
           'short_clip': dur <= 2.25,
           **{t: lab.get(t, '') for t in TARGETS},
           'source_label': lab.get('source', ''), 'sound_type': lab.get('sound type', ''), 'synthesis': lab.get('synthesis', ''),
           'articulation': lab.get('articulation', ''), 'effect': '', 'rhythm': '',
           'label_evidence': it['evidence'] + ('; ' + '; '.join(notes) if notes else ''), 'review_status': status,
           'acoustic': json.dumps(c, sort_keys=True), 'fold_group': it['fold_group'], 'split': 'train',
           'transformations': 'none (original file)', 'path': it['path']}
    if reasons: rejected.append({**rec, 'reject_reason': '; '.join(reasons)})
    else: accepted.append(rec); seen_pcm[pcm] = rec['id']

# Every candidate in the package that this pilot does not ingest, with the reason.
def pkg_rows():
    for r in csv.DictReader(open(os.path.join(PKG, 'instruments-environment/new_source_shortlist.csv'))):
        if r['source'] in ('Karoryfer Big Little Bass', 'Kenney Impact Sounds', 'OpenGameArt rubberduck 100 CC0 SFX 2'): continue
        why = {'VCSL': 'already used by tagger run 7 (prepare-vcsl.py), whose held-out VCSL folders are its test set',
               'VSCO-2-CE': 'same Versilian recording family as VCSL in run 7; deferred until a recording-level match makes a source-disjoint split possible'}.get(
               r['source'], 'deferred: 1-3 files per label from one session, too few for a head or holdout')
        yield {'family': r['source'], 'archive_member': r['archive_member'], 'original_url': r['download_url'], 'creator': r['creator'],
               'license': r['license'], 'labels_claimed': r['dge_labels'], 'reject_reason': why}
    for r in csv.DictReader(open(os.path.join(PKG, 'synth-vocal/file_manifest.csv'))):
        yield {'family': 'publicsamples (modularsamples)', 'archive_member': r.get('path') or r.get('file_path') or '', 'original_url': r.get('raw_url') or r.get('url') or '',
               'creator': 'Modular Samples', 'license': r.get('license', ''), 'labels_claimed': r.get('candidate_labels') or r.get('labels') or '',
               'reject_reason': 'quarantined: creator is reserved Freesound uploader modularsamples'}
    eff = json.load(open(os.path.join(PKG, 'effects/manifest.json')))
    for r in eff['freesound_examples']:
        yield {'family': 'freesound', 'archive_member': r['source_id'], 'original_url': r['source_url'], 'creator': r.get('uploader', ''),
               'license': r.get('license', ''), 'labels_claimed': ';'.join(r.get('candidate_labels', [])),
               'reject_reason': 'excluded: known prior ID or reserved uploader family' if r.get('status', '').startswith('exclu') or 'exclu' in r.get('newness_status', '')
               else 'not ingested: lossy preview only (original needs sign-in), single recording; unreviewed'}
    for r in eff['existing_dataset_archives']:
        yield {'family': 'EGFxSet', 'archive_member': r['source_id'], 'original_url': r['download_url'], 'creator': 'EGFxSet authors',
               'license': r.get('license', ''), 'labels_claimed': ';'.join(r.get('candidate_labels', [])),
               'reject_reason': 'already represented in DGE training recipes (not new data)'}
pkg_rejected = list(pkg_rows())

fields = list(accepted[0].keys())
with open(os.path.join(OUT, 'accepted.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fields); w.writeheader(); w.writerows(accepted)
rfields = ['family', 'archive_member', 'original_url', 'creator', 'license', 'labels_claimed', 'reject_reason']
with open(os.path.join(OUT, 'rejected.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, rfields, extrasaction='ignore'); w.writeheader()
    for r in rejected: w.writerow({**r, 'labels_claimed': ';'.join(t for t in TARGETS if r.get(t) == 1)})
    w.writerows(pkg_rejected)
creator_flags = sorted({c for c in ('kenney', 'rubberduck', 'karoryfer') if c in EXCL_UPLOADERS})
summary = {'accepted': len(accepted), 'rejected_downloaded': len(rejected), 'rejected_package_rows': len(pkg_rejected),
           'by_family': Counter(r['family'] for r in accepted),
           'positives': {t: sum(r[t] == 1 for r in accepted) for t in TARGETS},
           'explicit_negatives': {t: sum(r[t] == 0 for r in accepted) for t in TARGETS},
           'positive_groups': {t: len({r['fold_group'] for r in accepted if r[t] == 1}) for t in TARGETS},
           'check_failed': Counter(r['review_status'] for r in accepted if r['review_status'].startswith('name check failed')),
           'short_clips': sum(r['short_clip'] for r in accepted),
           'creator_handles_in_prior_freesound_inventory': creator_flags,
           'rejected_reasons': Counter(r['reject_reason'] for r in pkg_rejected + rejected)}
json.dump(summary, open(os.path.join(OUT, 'summary.json'), 'w'), indent=1, default=dict)
print(json.dumps(summary, indent=1, default=dict))
