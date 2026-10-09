"""Build a TUNING set of full songs for the app's whole-song display rules, from Mixing Secrets raw stems (RawStems).

The 417 MedleyDB/MoisesDB songs (docs/evaluations/whole-songs-2026-10-09) judge whole-song tags and must never be tuned
on. Rules and thresholds for full songs ("sound effect", "texture", voice, ...) are tuned on these songs instead: real
recordings by real players, from the dev/ folder the tagger is allowed to train on (non-commercial; any weights or
thresholds fitted on them keep CC BY-NC-SA). Songs by MedleyDB artists are skipped, as in prepare-rawstems.py.

Every stem is summed into the mix. A tag is present when a stem that IS that instrument is audible in at least one 10 s
window (stem RMS above -60 dBFS and within 30 dB of the mix, prepare-rawstems.py's rule), absent when no audible stem is
or might be it, and left out (unknown) otherwise, so a stem named "fx" or anything unrecognised leaves the effect tags
unknown rather than absent. Audio is written as MP3 to <out>/<shard>/<id>.mp3 and never committed.
Usage: python3 scripts/tuning-songs/build-mss.py <out dir> <manifest.json> <songs> <shards> [--workers 4]"""
import argparse, hashlib, importlib.util, json, os, re, shutil, subprocess, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('rawstems', os.path.join(HERE, '../audio-model/prepare-rawstems.py'))
rs = importlib.util.module_from_spec(spec); spec.loader.exec_module(rs)
CATALOG = {c['label'] for c in json.load(open(os.path.join(HERE, '../../src/audio/djCatalog.json')))['categories']}
SCORED = sorted(set(rs.ALL) & CATALOG)
RATE, SECS = 44100, 10
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

def decode(path):
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1'], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.float32)

def song(args, folder, files, out_path):
    from huggingface_hub import hf_hub_download
    dest = os.path.join(args.cache, h(folder)[:12])
    try:
        stems, audio = {}, {}
        for f in files:
            lab = rs.stem_labels('/'.join(f.split('/')[2:-1]), f.split('/')[-1])
            if lab is None: continue
            for i in range(6):
                try: p = hf_hub_download(rs.REPO[0], f, repo_type='dataset', revision=rs.REPO[1], local_dir=dest); break
                except Exception:
                    if i == 5: raise
                    time.sleep(3 * (i + 1))
            stems[f], audio[f] = lab, decode(p); os.remove(p)
        if not stems: return None
        n = max(len(a) for a in audio.values()); mix = np.zeros(n, np.float32)
        for a in audio.values(): mix[:len(a)] += a
        scale = 0.9 / max(1e-6, float(np.abs(mix).max())); w = SECS * RATE
        heard = {s: False for s in stems}
        for a in range(0, max(1, n - w // 2), w):
            mx = rs.rms_db(mix[a:a + w] * scale)
            if mx < -50: continue
            for s in stems:
                y = audio[s][a:a + w] * scale
                if len(y) and rs.rms_db(y) > -60 and rs.rms_db(y) >= mx - 30: heard[s] = True
        present = set().union(*(stems[s][0] for s in stems if heard[s]))
        maybe = set().union(*(stems[s][0] | stems[s][1] for s in stems if heard[s]))
        tags = {t: 1 for t in SCORED if t in present} | {t: 0 for t in SCORED if t not in maybe}
        subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', 'pipe:0', '-b:a', '192k', out_path],
                       input=(mix * scale).astype(np.float32).tobytes(), check=True)
        return {'tags': tags, 'seconds': round(n / RATE, 1), 'stems': len(stems)}
    except Exception as e:
        print(f'  skip {folder}: {type(e).__name__}: {e}', flush=True); return None
    finally: shutil.rmtree(dest, ignore_errors=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('manifest'); ap.add_argument('songs', type=int); ap.add_argument('shards', type=int)
    ap.add_argument('--workers', type=int, default=4); args = ap.parse_args()
    args.cache = os.path.join(args.out, 'download')
    from huggingface_hub import HfApi
    files = [f for f in HfApi().list_repo_files(rs.REPO[0], repo_type='dataset', revision=rs.REPO[1]) if f.startswith('dev/') and re.search(r'\.(flac|wav)$', f)]
    by = {}
    for f in files: by.setdefault('/'.join(f.split('/')[:2]), []).append(f)
    held = rs.medleydb_artists()
    folders = sorted((s for s in by if re.sub(r'[^a-z0-9]', '', s.split('/')[1].split(' - ')[0].lower()) not in held), key=lambda s: h('dge-tuning-songs', s))
    artists, picked = set(), []
    for s in folders:   # one song per artist, so no artist dominates the tuning
        a = s.split('/')[1].split(' - ')[0].lower()
        if a not in artists: artists.add(a); picked.append(s)
        if len(picked) == args.songs: break
    for k in range(args.shards): os.makedirs(os.path.join(args.out, str(k)), exist_ok=True)
    ids = {s: 'ts-' + h('dge-tuning-songs-2026-10-09', s)[:16] for s in picked}
    jobs = [(s, os.path.join(args.out, str(k % args.shards), ids[s] + '.mp3')) for k, s in enumerate(picked)]
    with ThreadPoolExecutor(args.workers) as pool:
        got = list(pool.map(lambda j: song(args, j[0], by[j[0]], j[1]), jobs))
    items = [{'id': ids[s], 'source': f'Mixing Secrets (RawStems) {s.split("/")[1]}', 'split': 'test', 'tier': 'song',
              'groups': {'artist': 'mss:' + s.split('/')[1].split(' - ')[0]}, 'seconds': r['seconds'], 'tags': r['tags']}
             for (s, _), r in zip(jobs, got) if r]
    json.dump({'version': 1, 'kind': 'tuning set (never a judge set)', 'source': f'hf://datasets/{rs.REPO[0]}@{rs.REPO[1][:7]} dev/',
               'scored': SCORED, 'items': items}, open(args.manifest, 'w'), separators=(',', ':'))
    shutil.rmtree(args.cache, ignore_errors=True)
    pos = {t: sum(i['tags'].get(t) == 1 for i in items) for t in SCORED}; neg = {t: sum(i['tags'].get(t) == 0 for i in items) for t in SCORED}
    print(len(items), 'songs;', ', '.join(f'{t} {pos[t]}/{pos[t] + neg[t]}' for t in sorted(SCORED, key=lambda t: -pos[t]) if pos[t] + neg[t]))

if __name__ == '__main__':
    main()
