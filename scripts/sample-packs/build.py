"""Fetch free sample packs from archive.org and write them as opaque, label-blind upload files plus a frozen manifest.

Usage: python3 scripts/sample-packs/build.py <audio-out-dir> <download-cache-dir>

Packs (each file's truth comes only from the pack's own naming convention, written down below before any scoring):
  * Transmutation by A Kind Of Likeness (archive.org/details/transmutation-akol; README: CC0 1.0, item page: CC BY 4.0).
    [PREFIX]_[NAME]_[BPM]_[KEY]. Folders ARP, BASS, CHORD, DRUM/LOOPS, DRUM/ONESHOT/{BD,HHT,SD,MISC}, GTR, PAD.
    A bare key letter is major, a trailing m/min is minor, dor/phr/lyd/mix/loc name a mode on that root. TEXTURE is
    left out (noise and drones: no tempo, key or instrument truth). 24-bit / 44.1 kHz WAV.
  * 808 Variations by Beckstrom (archive.org/details/808_variations, CC BY 4.0): TR-808 one-shots re-recorded through
    26 devices (cassette, megaphone, bad MP3 ...). The suffix names the voice: BD, SD, HH, OHH, CP, CB, CYMBAL, ...
  * Digitalismo Urbano (archive.org/details/digitalismourbano, CC BY 3.0): found-sound percussion loops, MP3, with
    "<n>BPM" in the name.
  * Format checks: 12 Transmutation files re-encoded by ffmpeg into other containers, bit depths, sample rates and
    lengths (24-bit/96 kHz, 32-bit float, 8-bit, 8 kHz, mono, AIFF, FLAC, OGG, a 50 ms one-shot, ...). Truth is the
    source file's, except that cut files keep no tempo.
Every file is written as <id>.<original extension> (ids are a seeded hash) so neither the name nor the folder leaks
into the analysis; a second folder holds the same audio under its original file name, to check names with spaces,
'#', brackets and the like load. Audio is fetched at run time and never committed.
"""
import hashlib, json, os, re, subprocess, sys, urllib.parse, urllib.request, zipfile, time

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'sample-packs-2026-10-06')
SEED = 'dge-sample-packs-2026-10-06'
audio_out, cache = sys.argv[1], sys.argv[2]
named_out = audio_out.rstrip('/') + '-named'
for d in (audio_out, named_out, cache, OUT): os.makedirs(d, exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
NOTES = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
MODES = {'': 'major', 'm': 'minor', 'min': 'minor', 'dor': 'dorian', 'phr': 'phrygian', 'lyd': 'lydian', 'mix': 'mixolydian', 'loc': 'locrian'}
IA = 'https://archive.org/download/'

def get(url, path, check):
    if os.path.exists(path) and check(path): return path
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=300) as r, open(path, 'wb') as f:
                while chunk := r.read(1 << 20): f.write(chunk)
            if check(path): return path
        except Exception as e: print('retry', url, e, file=sys.stderr)
        time.sleep(2 ** attempt)
    sys.exit(f'could not fetch {url}')

def digest(path, algo):
    d = hashlib.new(algo)
    with open(path, 'rb') as f:
        while chunk := f.read(1 << 20): d.update(chunk)
    return d.hexdigest()

def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,bits_per_sample,bits_per_raw_sample,sample_fmt:format=duration,format_name',
                          '-of', 'json', path], capture_output=True, text=True)
    j = json.loads(out.stdout or '{}'); s = (j.get('streams') or [{}])[0]; f = j.get('format', {})
    bits = int(s.get('bits_per_raw_sample') or s.get('bits_per_sample') or 0) or None
    return {'container': f.get('format_name'), 'codec': s.get('codec_name'), 'sampleRate': int(s.get('sample_rate') or 0), 'channels': s.get('channels'),
            'bits': bits, 'sampleFormat': s.get('sample_fmt'), 'durationSeconds': round(float(f.get('duration') or 0), 3)}

items = []
def add(pack, original, src, truth, licence, transformation=None):
    ext = os.path.splitext(src)[1].lower()
    iid = 'sp-' + h(SEED, pack, original, transformation or '')[:16]
    dst = os.path.join(audio_out, iid + ext)
    if not os.path.exists(dst): os.link(src, dst) if os.stat(src).st_dev == os.stat(audio_out).st_dev else subprocess.run(['cp', src, dst], check=True)
    named = os.path.basename(original) if not transformation else f'{os.path.splitext(os.path.basename(original))[0]} [{transformation}]{ext}'
    items.append({'id': iid, 'file': iid + ext, 'originalName': named, 'pack': pack, 'source': original, 'licence': licence,
                  'transformation': transformation, 'format': probe(dst), 'split': 'test', **truth})

# --- Transmutation ---------------------------------------------------------------------------------------------
AKOL = 'transmutation-akol'
sums = urllib.request.urlopen(IA + AKOL + '/SHA256SUMS.txt', timeout=60).read().decode()
sha = {line.split('*')[1].strip(): line.split()[0] for line in sums.splitlines() if '*' in line}
akol_dir = os.path.join(cache, 'akol')
FOLDER_TRUTH = {'ARP': ('arp loop', ['synthesizer']), 'BASS': ('bass loop', ['bass']), 'CHORD': ('chord loop', []), 'GTR': ('guitar loop', ['guitar']),
                'PAD': ('pad loop', []), 'LOOPS': ('drum loop', ['drums']), 'BD': ('kick', ['drums', 'kick']), 'SD': ('snare or clap', ['drums', 'percussion hit']),
                'HHT': ('hi-hat', ['drums', 'hi-hat']), 'MISC': ('percussion', ['drums', 'percussion hit'])}
# Absent only where the pack makes it certain: a drum one-shot or drum loop has no voice, guitar or piano; a guitar or
# bass loop has no voice. Everything else is unknown (never scored as absent).
ABSENT = {'kick': ['voice', 'guitar', 'piano', 'synthesizer', 'snare', 'hi-hat', 'clap'], 'snare or clap': ['voice', 'guitar', 'piano', 'synthesizer', 'kick', 'hi-hat'],
          'hi-hat': ['voice', 'guitar', 'piano', 'synthesizer', 'kick', 'bass', 'snare', 'clap'], 'percussion': ['voice', 'guitar', 'piano'],
          'drum loop': ['voice', 'guitar', 'piano'], 'guitar loop': ['voice', 'drums', 'piano'], 'bass loop': ['voice', 'guitar', 'piano'],
          'arp loop': ['voice', 'guitar'], 'pad loop': ['voice', 'drums'], 'chord loop': ['voice']}
akol_files = []
for part in ['ARP', 'BASS', 'CHORD', 'DRUM', 'GTR', 'PAD']:
    z = f'Transmutation-AKOL-{part}.zip'
    path = get(IA + AKOL + '/' + z, os.path.join(cache, z), lambda p, z=z: digest(p, 'sha256') == sha[z])
    with zipfile.ZipFile(path) as zf:
        for n in sorted(zf.namelist()):
            if not n.lower().endswith('.wav') or '/__MACOSX' in n or os.path.basename(n).startswith('._'): continue
            dst = os.path.join(akol_dir, n)
            if not os.path.exists(dst): os.makedirs(os.path.dirname(dst), exist_ok=True); open(dst, 'wb').write(zf.read(n))
            akol_files.append((n, dst))
for n, dst in akol_files:
    base = os.path.splitext(os.path.basename(n))[0]
    folder = n.split('/')[-2]
    kind, present = FOLDER_TRUTH[folder]
    m = re.search(r'_(\d{2,3})(?:_([A-G]#?)(m|min|dor|phr|lyd|mix|loc)?)?$', base) or re.search(r'_()([A-G]#?)(m|min|dor|phr|lyd|mix|loc)?$', base)
    bpm = int(m.group(1)) if m and m.group(1) else None
    key = {'tonic': NOTES[m.group(2)], 'mode': MODES[m.group(3) or '']} if m and m.group(2) else None
    labels = {l: 'present' for l in present} | {l: 'absent' for l in ABSENT[kind] if l not in present}
    add('Transmutation', n, dst, {'kind': kind, 'oneShot': folder in ('BD', 'SD', 'HHT', 'MISC'), 'tempo': bpm, 'key': key, 'labels': labels},
        'CC0 1.0 (pack README) / CC BY 4.0 (archive.org item)')

# --- 808 Variations --------------------------------------------------------------------------------------------
meta = json.load(urllib.request.urlopen(IA.replace('/download/', '/metadata/') + '808_variations', timeout=60))
VOICE = {'BD': ['kick'], 'SD': ['snare'], 'HH': ['hi-hat'], 'OHH': ['hi-hat'], 'CP': ['clap'], 'CB': ['cowbell'], 'CYMBAL': ['cymbal'],
         'RIM': ['percussion hit'], 'CLAVE': ['percussion hit'], 'MAR': ['percussion hit'], 'TOM1': ['percussion hit'], 'TOM2': ['percussion hit'], 'TOM3': ['percussion hit']}
for f in sorted(meta['files'], key=lambda f: f['name']):
    n = f['name']
    voice = n.rsplit('_', 1)[-1][:-4] if n.endswith('.wav') else None
    if voice not in VOICE: continue
    dst = os.path.join(cache, '808', n); os.makedirs(os.path.dirname(dst), exist_ok=True)
    get(IA + '808_variations/' + urllib.parse.quote(n), dst, lambda p, f=f: digest(p, 'md5') == f['md5'])
    labels = {'drums': 'present', 'voice': 'absent', 'guitar': 'absent', 'piano': 'absent'} | {l: 'present' for l in VOICE[voice]}
    # The other named voices are absent (an open hi-hat is not scored as a cymbal; "percussion hit" covers every voice).
    labels |= {l: 'absent' for l in ['kick', 'snare', 'hi-hat', 'clap', 'cowbell', 'cymbal'] if l not in VOICE[voice] and not (voice == 'OHH' and l == 'cymbal')}
    add('808 Variations', n, dst, {'kind': '808 ' + voice, 'oneShot': True, 'tempo': None, 'key': None, 'labels': labels, 'device': n.split('/')[1]}, 'CC BY 4.0 (Beckstrom)')

# --- Digitalismo Urbano ----------------------------------------------------------------------------------------
meta = json.load(urllib.request.urlopen(IA.replace('/download/', '/metadata/') + 'digitalismourbano', timeout=60))
for f in sorted(meta['files'], key=lambda f: f['name']):
    n = f['name']; m = re.search(r'(\d{2,3})\s*bpm', n, re.I)
    if not n.endswith('.mp3') or not m: continue
    dst = os.path.join(cache, 'du', n); os.makedirs(os.path.dirname(dst), exist_ok=True)
    get(IA + 'digitalismourbano/' + urllib.parse.quote(n), dst, lambda p, f=f: digest(p, 'md5') == f['md5'])
    add('Digitalismo Urbano', n, dst, {'kind': 'found-sound loop', 'oneShot': False, 'tempo': int(m.group(1)), 'key': None,
        'labels': {'voice': 'absent', 'guitar': 'absent', 'piano': 'absent'}}, 'CC BY 3.0')

# --- Format checks ---------------------------------------------------------------------------------------------
FORMATS = [('24-bit 96 kHz WAV', '.wav', ['-ar', '96000', '-c:a', 'pcm_s24le']), ('32-bit float WAV', '.wav', ['-c:a', 'pcm_f32le']),
           ('8-bit WAV', '.wav', ['-c:a', 'pcm_u8']), ('8 kHz mono WAV', '.wav', ['-ar', '8000', '-ac', '1', '-c:a', 'pcm_s16le']),
           ('48 kHz 16-bit WAV', '.wav', ['-ar', '48000', '-c:a', 'pcm_s16le']), ('AIFF', '.aiff', ['-c:a', 'pcm_s16be']), ('FLAC', '.flac', ['-c:a', 'flac']),
           ('OGG', '.ogg', ['-c:a', 'libvorbis', '-q:a', '5']), ('M4A', '.m4a', ['-c:a', 'aac', '-b:a', '192k']), ('MP3', '.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']),
           ('first 50 ms', '.wav', ['-t', '0.05']), ('first 0.5 s', '.wav', ['-t', '0.5'])]
pick = sorted((it for it in items if it['pack'] == 'Transmutation'), key=lambda it: h(SEED, 'formats', it['id']))
srcs = [next(it for it in pick if it['kind'] == k) for k in ['drum loop', 'bass loop', 'kick', 'arp loop', 'guitar loop', 'hi-hat']]
for i, (name, ext, args) in enumerate(FORMATS):
    it = srcs[i % len(srcs)]
    dst = os.path.join(cache, 'formats', f'{i:02d}{ext}'); os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(audio_out, it['file']), *args, dst], check=True)
    truth = {k: it[k] for k in ('kind', 'oneShot', 'key', 'labels')} | {'tempo': None if name.startswith('first') else it['tempo']}
    add('Format checks', it['source'], dst, truth, it['licence'], transformation=name)

# Real names: a name used twice (808 Variations repeats 808_BD.wav in several device folders) gets its folder in front.
from collections import Counter
dupes = Counter(it['originalName'] for it in items)
for it in items:
    if dupes[it['originalName']] > 1: it['originalName'] = f"{it['source'].split('/')[-2]} {it['originalName']}"
    target = os.path.join(named_out, it['originalName'])
    if not os.path.exists(target): subprocess.run(['cp', os.path.join(audio_out, it['file']), target], check=True)
assert len({it['originalName'] for it in items}) == len(items), 'real file names still collide'
manifest = {'version': 1, 'frozenAt': '2026-10-06T05:30:00Z', 'seed': SEED, 'selection': __doc__.strip(), 'items': items}
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
print(len(items), 'items', Counter(it['pack'] for it in items), Counter((it['format']['codec'], it['format']['bits'], it['format']['sampleRate']) for it in items))
