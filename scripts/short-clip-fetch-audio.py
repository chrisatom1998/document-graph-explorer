"""Rebuild the frozen short-clip benchmark audio from public sources, for runs away from the original machine.

Usage: python3 scripts/short-clip-fetch-audio.py <out-dir> [split=test] [cache-dir=<out-dir>/../short-clip-sources]

Reads docs/evaluations/short-clips-2026-10-04/manifest.json and writes <out-dir>/<id>.wav for every item in the split:
  * FSD50K clips: the unchanged dataset wav, from the Hugging Face mirror Fhrozen/FSD50k (clips/{eval,dev}/<id>.wav).
  * NSynth notes: first 1.0 or 2.0 s of the note with a 10 ms fade-out (as scripts/build-short-clip-bench.py does).
  * AVP utterances: the manifest's start/end crop with a 10 ms fade-out.
Every clip's duration is checked against item-meta.json; a mismatch stops the run rather than scoring different audio.
"""
import concurrent.futures, io, json, os, re, subprocess, sys, tarfile, tempfile, time, urllib.request, wave, zipfile

ROOT = os.path.join(os.path.dirname(__file__), '..')
B = os.environ.get('BENCH', f'{ROOT}/docs/evaluations/short-clips-2026-10-04')
if len(sys.argv) < 2: sys.exit(__doc__)
out = sys.argv[1]; split = sys.argv[2] if len(sys.argv) > 2 else 'test'
cache = sys.argv[3] if len(sys.argv) > 3 else os.path.join(out, '..', 'short-clip-sources')
os.makedirs(out, exist_ok=True); os.makedirs(cache, exist_ok=True)
items = [i for i in json.load(open(f'{B}/manifest.json'))['items'] if i['split'] == split]
meta = json.load(open(f'{B}/item-meta.json'))
FSD = 'https://huggingface.co/datasets/Fhrozen/FSD50k/resolve/main/clips/{part}/{fid}.wav'
NSYNTH = 'http://download.magenta.tensorflow.org/datasets/nsynth/nsynth-test.jsonwav.tar.gz'
AVP = 'https://zenodo.org/records/3245959/files/AVP_Dataset.zip?download=1'

def get(url, tries=6):
    for n in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'dge-short-clip-bench'}), timeout=300) as r: return r.read()
        except Exception as e:
            if n == tries - 1: raise
            print(f'retry {url}: {e}', file=sys.stderr); time.sleep(2 ** n)

def download(url, path):
    if not os.path.exists(path):
        subprocess.run(['curl', '-fsSL', '--retry', '6', '-o', path + '.part', url], check=True); os.replace(path + '.part', path)
    return path

def duration(data):
    with wave.open(io.BytesIO(data)) as w: return w.getnframes() / w.getframerate()

def crop(src, start, dur, fade=0.01):
    # Same ffmpeg filter as the benchmark build, written to a seekable file so the WAV header carries real sizes.
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'clip.wav')
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-ss', f'{start:.4f}', '-t', f'{dur:.4f}',
                        '-af', f'afade=t=out:st={max(0, dur - fade):.4f}:d={fade}', '-ac', '1', '-c:a', 'pcm_s16le', '-bitexact', path],
                       input=src, capture_output=True, check=True)
        return open(path, 'rb').read()

def save(item, data):
    want = meta[item['id']]['durationSeconds']
    if abs(duration(data) - want) > 0.01: sys.exit(f"{item['id']}: duration {duration(data):.4f} s, manifest says {want} s ({item['source']})")
    open(os.path.join(out, f"{item['id']}.wav"), 'wb').write(data)

todo = [i for i in items if not os.path.exists(os.path.join(out, f"{i['id']}.wav"))]
fsd = [i for i in todo if i['source'].startswith('FSD50K')]
def fetch_fsd(item):
    part, fid = re.match(r'FSD50K (eval|dev) clip (\d+):', item['source']).groups()
    save(item, get(FSD.format(part=part, fid=fid)))
with concurrent.futures.ThreadPoolExecutor(8) as pool: list(pool.map(fetch_fsd, fsd))

nsynth = {re.match(r'NSynth nsynth-test note (\S+) ', i['source']).group(1): i for i in todo if i['source'].startswith('NSynth')}
if nsynth:
    with tarfile.open(download(NSYNTH, f'{cache}/nsynth-test.jsonwav.tar.gz')) as tf:
        for member in tf:
            name = os.path.basename(member.name)[:-4] if member.name.endswith('.wav') else None
            if name in nsynth: save(nsynth[name], crop(tf.extractfile(member).read(), 0, nsynth[name]['end']))

avp = [i for i in todo if i['source'].startswith('AVP')]
if avp:
    z = zipfile.ZipFile(download(AVP, f'{cache}/AVP_Dataset.zip'))
    for item in avp:
        wavn = re.match(r'AVP (\S+\.wav) onset', item['source']).group(1)
        save(item, crop(z.read(wavn), item['start'], item['end'] - item['start']))

missing = [i['id'] for i in items if not os.path.exists(os.path.join(out, f"{i['id']}.wav"))]
if missing: sys.exit(f'{len(missing)} clips missing, e.g. {missing[:5]}')
print(f'{len(items)} {split} clips ready in {out}')
