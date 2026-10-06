#!/usr/bin/env python3
"""Build long "songs" from labelled OpenMIC-2018 clips, for testing whole-recording aggregation.

Every song is SEGMENTS ten-second clips joined end to end, built in pairs around one target instrument:
- a target song, where the target plays only in a TARGET_RUN-clip stretch mid-song (clips labelled present)
  and every other clip is labelled absent for it;
- a control song of SEGMENTS clips that are all labelled absent for the target.
Song-level labels: present if any clip is labelled present; absent if every clip is labelled absent;
otherwise unknown (never a negative). Only the official *train* partition is used, the 48 clips of the
frozen 2026-10-03 pilot are excluded, and no clip is used twice, so the locked test split stays untouched.

Usage: python3 scripts/build-stitched-songs.py <extracted openmic-2018 dir> <out-dir> [pairs-per-class=2]
Extract openmic-2018-v1.0.0.tgz first (random access into the gzip archive re-decompresses it per clip).
Needs ffmpeg. Writes <out-dir>/audio/<id>.wav and <out-dir>/songs.json.
"""
import csv, hashlib, json, random, subprocess, sys
from collections import defaultdict
from pathlib import Path

SEGMENTS, TARGET_RUN, SEED = 8, 2, 'stitched-songs-2026-10-05'
root, out = Path(sys.argv[1]), Path(sys.argv[2])
pairs = int(sys.argv[3]) if len(sys.argv) > 3 else 2
pilot = json.loads(Path('docs/evaluations/openmic-2026-10-03/manifest.json').read_text())
pilot_keys = {i['id'] for i in pilot['items']}

train = set((root / 'partitions/split01_train.csv').read_text().split())
labels = defaultdict(dict)  # sample_key -> instrument -> present?
for row in csv.DictReader((root / 'openmic-2018-aggregated-labels.csv').read_text().splitlines()):
    labels[row['sample_key']][row['instrument']] = float(row['relevance']) >= .5
classes = sorted({c for v in labels.values() for c in v})
pool = sorted(k for k in train if k in labels and k not in pilot_keys)
rng = random.Random(SEED)
songs, used = [], set()

def take(keys, n):
    picked = []
    while len(picked) < n:
        k = keys.pop(rng.randrange(len(keys)))
        if k not in used: picked.append(k); used.add(k)
    return picked

def song(kind, target, n, clips, at=None):
    song_labels = {}
    for c in classes:
        seen = [labels[k].get(c) for k in clips]
        song_labels[c] = 'present' if True in seen else 'absent' if all(v is False for v in seen) else 'unknown'
    sid = 'ss-' + hashlib.sha256(f'{SEED}:{kind}:{target}:{n}'.encode()).hexdigest()[:12]
    extra = {'targetStart': at * 10, 'targetEnd': (at + TARGET_RUN) * 10} if at is not None else {}
    return {'id': sid, 'kind': kind, 'target': target, **extra, 'clips': clips, 'labels': song_labels}

for target in classes:
    pos = [k for k in pool if labels[k].get(target) is True]
    neg = [k for k in pool if labels[k].get(target) is False]
    for n in range(pairs):
        if len([k for k in pos if k not in used]) < TARGET_RUN or len([k for k in neg if k not in used]) < 2 * SEGMENTS - TARGET_RUN: break
        hits, rest = take(pos, TARGET_RUN), take(neg, SEGMENTS - TARGET_RUN)
        at = rng.randrange(1, SEGMENTS - TARGET_RUN)  # never first or last, so the stretch is mid-song
        songs.append(song('target', target, n, rest[:at] + hits + rest[at:], at))
        songs.append(song('control', target, n, take(neg, SEGMENTS)))

(out / 'audio').mkdir(parents=True, exist_ok=True)
for s in songs:
    parts = [root / 'audio' / k[:3] / f'{k}.ogg' for k in s['clips']]
    # Decode, pad or trim each clip to exactly 10 s at 44.1 kHz stereo, then join.
    inputs = sum((['-i', str(p)] for p in parts), [])
    chains = ''.join(f'[{i}:a]aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=10,atrim=0:10[a{i}];' for i in range(len(parts)))
    joined = ''.join(f'[a{i}]' for i in range(len(parts))) + f'concat=n={len(parts)}:v=0:a=1[out]'
    wav = out / 'audio' / f"{s['id']}.wav"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', chains + joined, '-map', '[out]', str(wav)], check=True)
    s['sha256'] = hashlib.sha256(wav.read_bytes()).hexdigest()
(out / 'songs.json').write_text(json.dumps({'seed': SEED, 'segments': SEGMENTS, 'targetRun': TARGET_RUN, 'classes': classes, 'songs': songs}, indent=1))
print(f'{len(songs)} songs, {sum(len(s["clips"]) for s in songs)} clips -> {out}')
