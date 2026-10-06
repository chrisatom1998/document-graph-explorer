"""Cut the tempo tuning and held-out clips.

Usage: python3 scripts/tempo/build-sets.py <giantsteps checkout> <gtzan genres.tar.gz> <out-dir>

tune    : GiantSteps tracks NOT in docs/evaluations/dj-clips-2026-10-06/giantsteps-manifest.json (10 s at 25% and 75% of
          the preview, 20 s from the middle), plus the GTZAN clips whose seeded hash puts them in the tuning half
          (middle 10 s and the full 30 s). GTZAN covers hip-hop, disco, reggae, pop, rock, jazz and others, so a rule
          tuned for EDM cannot silently break them.
gtzan-test: the other GTZAN half, same cuts; checked once after tuning.
holdout : the 500 frozen DJ-clip excerpts (middle 10 s), checked once after tuning.
Truth: GiantSteps v2 tempo (T1/T2 from annotations_v2/mirex), GTZAN tempo from TempoBeatDownbeat/gtzan_tempo_beat.
"""
import concurrent.futures, hashlib, json, os, subprocess, sys, tarfile, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
gs, gtzan_tgz, out = sys.argv[1], sys.argv[2], sys.argv[3]
GTZAN_TEMPO = 'gtzan-tempo'   # checkout of TempoBeatDownbeat/gtzan_tempo_beat in the working directory
BASE = 'https://www.cp.jku.at/datasets/giantsteps/backup/'
os.makedirs(f'{out}/audio', exist_ok=True)
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
rd = lambda *p: open(os.path.join(*p)).read().strip()
frozen = json.load(open(os.path.join(ROOT, 'docs/evaluations/dj-clips-2026-10-06/giantsteps-manifest.json')))['items']
held = {it['sampleKey'] for it in frozen}

def cut(src, dst, start, secs):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-t', str(secs), '-i', src, '-ac', '1', '-ar', '44100', dst], check=True)
dur = lambda p: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True).stdout)

def fetch(n):
    path = f'{out}/gs-{n}.mp3'
    for _ in range(4):
        try:
            data = urllib.request.urlopen(BASE + n + '.mp3', timeout=60).read()
            if hashlib.md5(data).hexdigest() == rd(gs, 'md5', n + '.md5').split()[0]:
                open(path, 'wb').write(data); return path
        except Exception: pass
    return None

rows = {'tune': [], 'gtzan-test': [], 'holdout': []}
names = sorted(f[:-4] for f in os.listdir(f'{gs}/annotations_v2/tempo'))
with concurrent.futures.ThreadPoolExecutor(4) as pool:
    paths = dict(zip(names, pool.map(fetch, names)))
for n in names:
    p = paths[n]
    if not p: continue
    t1, t2, s1 = (float(x) for x in rd(gs, 'annotations_v2', 'mirex', n + '.mirex').split())
    bpm = float(rd(gs, 'annotations_v2', 'tempo', n + '.bpm'))
    if bpm <= 0: continue
    base = {'source': 'giantsteps', 'key': n, 'genre': rd(gs, 'annotations', 'genre', n + '.genre'), 'truth': bpm, 't1': t1, 't2': t2}
    d = dur(p)
    if n in held:
        it = next(i for i in frozen if i['sampleKey'] == n)
        dst = f"{out}/audio/{it['id']}.wav"; cut(p, dst, it['start'], 10)
        rows['holdout'].append({**base, 'id': it['id'], 'path': dst, 'cut': 'mid10'})
    else:
        for tag, start, secs in [('q1-10', d * .25 - 5, 10), ('q3-10', d * .75 - 5, 10), ('mid20', d / 2 - 10, 20)]:
            dst = f'{out}/audio/gs-{n}-{tag}.wav'; cut(p, dst, max(0, start), secs)
            rows['tune'].append({**base, 'id': f'gs-{n}-{tag}', 'path': dst, 'cut': tag})
    os.remove(p)

with tarfile.open(gtzan_tgz, 'r|gz') as tf:
    for m in tf:
        name = os.path.basename(m.name)
        if not m.isfile() or not name.endswith('.wav') or name.startswith('._'): continue
        genre, num = name[:-4].split('.')   # blues.00015.wav
        ann = f'{GTZAN_TEMPO}/tempo/gtzan_{genre}_{num}.bpm'
        if not os.path.exists(ann): continue
        bpm = float(rd(ann))
        src = f'{out}/tmp.wav'; open(src, 'wb').write(tf.extractfile(m).read())
        split = 'tune' if int(h('gtzan-split', name)[:8], 16) % 2 == 0 else 'gtzan-test'
        base = {'source': 'gtzan', 'key': name, 'genre': genre, 'truth': bpm, 't1': bpm, 't2': 0}
        try: d = dur(src)
        except ValueError: continue
        for tag, start, secs in [('mid10', d / 2 - 5, 10), ('full', 0, d)]:
            dst = f'{out}/audio/gz-{genre}-{num}-{tag}.wav'
            try: cut(src, dst, max(0, start), secs)
            except subprocess.CalledProcessError: continue   # GTZAN has one known-corrupt file
            rows[split].append({**base, 'id': f'gz-{genre}-{num}-{tag}', 'path': dst, 'cut': tag})
if os.path.exists(f'{out}/tmp.wav'): os.remove(f'{out}/tmp.wav')
for k, v in rows.items():
    json.dump(v, open(f'{out}/clips-{k}.json', 'w'))
    print(k, len(v))
