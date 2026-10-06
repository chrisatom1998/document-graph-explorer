"""Cut tempo clips from the GiantSteps MTG key dataset (Beatport EDM previews with a Beatport BPM).

Usage: python3 scripts/tempo/build-mtg.py <giantsteps-mtg-key-dataset checkout> <out-dir>

mtg-tune: tracks NOT in the round 2 DJ test and not reserved for round 3 (docs/evaluations/dj-clips-round2-2026-10-06/mtg-key-manifest.json),
          10 s at 25% and 75% of the preview. Used to tune the triplet-feel tempo check.
round2  : the 500 frozen round 2 excerpts (same start, 10 s), checked once after tuning.
Truth is Beatport's BPM, which often lists drum & bass at half tempo, so tuning uses it only up to a factor of two.
"""
import concurrent.futures, csv, hashlib, json, os, subprocess, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
BASE = 'https://www.cp.jku.at/datasets/giantsteps/mtg_key_backup/'
repo, out = sys.argv[1], sys.argv[2]
os.makedirs(f'{out}/audio', exist_ok=True)
meta = {r['ID'].strip(): r for r in csv.DictReader(open(os.path.join(repo, 'annotations', 'beatport_metadata.txt')), delimiter='\t')}
frozen = {it['sampleKey']: it for it in json.load(open(os.path.join(ROOT, 'docs/evaluations/dj-clips-round2-2026-10-06/mtg-key-manifest.json')))['items']}
names = sorted(f[:-len('.md5')] for f in os.listdir(os.path.join(repo, 'md5')))
bpm_of = lambda n: float((meta.get(n.split('.')[0], {}).get('BP BPM') or '0').strip() or 0)
names = [n for n in names if bpm_of(n) > 0]
# Half of the unused tracks are reserved as a round 3 held-out set (docs/evaluations/holdout-r3-2026-10-06).
r3 = lambda n: int(hashlib.sha256(f'dge-holdout-r3-2026-10-06|{n}'.encode()).hexdigest()[:8], 16) % 2 == 0
names = [n for n in names if n in frozen or not r3(n)]

def cut(src, dst, start, secs):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', str(secs), '-i', src, '-ac', '1', '-ar', '44100',
                    '-c:a', 'flac', dst], check=True)

def job(n):
    want = open(os.path.join(repo, 'md5', n + '.md5')).read().split()[0]
    for attempt in range(6):
        try:
            data = urllib.request.urlopen(BASE + n + '.mp3', timeout=60).read()
            if hashlib.md5(data).hexdigest() == want: break
        except Exception: pass
        time.sleep(2 ** attempt)
    else: return []
    tmp = f'{out}/{n}.mp3'; open(tmp, 'wb').write(data)
    m = meta[n.split('.')[0]]
    base = {'source': 'mtg', 'key': n, 'genre': m['BP GENRE'].strip().lower().replace(' & ', '-and-').replace(' ', '-'),
            'truth': bpm_of(n), 't1': bpm_of(n), 't2': 0}
    rows = []
    try:
        if n in frozen:
            it = frozen[n]; dst = f"{out}/audio/{it['id']}.flac"; cut(tmp, dst, it['start'], 10)
            rows.append(('round2', {**base, 'id': it['id'], 'path': dst, 'cut': 'mid10'}))
        else:
            d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp],
                                     capture_output=True, text=True).stdout)
            for tag, start in (('q1-10', d * .25 - 5), ('q3-10', d * .75 - 5)):
                dst = f'{out}/audio/mk-{n}-{tag}.flac'; cut(tmp, dst, max(0, start), 10)
                rows.append(('mtg-tune', {**base, 'id': f'mk-{n}-{tag}', 'path': dst, 'cut': tag}))
    finally: os.remove(tmp)
    return rows

sets = {'mtg-tune': [], 'round2': []}
with concurrent.futures.ThreadPoolExecutor(6) as pool:
    for rows in pool.map(job, names):
        for k, r in rows: sets[k].append(r)
# The backup drops a few downloads per run; the report gives each set's clip count.
if len(sets['round2']) < len(frozen) - 10: sys.exit(f"only {len(sets['round2'])} of {len(frozen)} round 2 excerpts fetched")
for k, v in sets.items():
    json.dump(v, open(f'{out}/clips-{k}.json', 'w')); print(k, len(v))
