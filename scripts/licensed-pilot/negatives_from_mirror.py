"""Broad CC0 negatives for the pilot heads, from the Freesound LAION-640k mirror on Hugging Face.

Usage: python3 -I scripts/licensed-pilot/negatives_from_mirror.py <exclusion-manifest.json> <no-source-candidates.csv> <out-dir> <shard.parquet>...
Shards: https://huggingface.co/datasets/benjamin-paine/freesound-laion-640k/resolve/main/data/test-000NN-of-00123.parquet (NN = 00..05).
Writes <out-dir>/audio/<freesound id>.wav (first 10 s, mono 48 kHz, which is all the app's first CLAP window reads),
<out-dir>/negatives.csv and summary.json.

Kept only when ALL hold: licence CC0-1.0 in the mirror (code 0, no attribution, commercial use allowed); the Freesound ID
and uploader appear in no DGE exclusion set (prior, held-out or reserved IDs and uploaders, case-folded), break no
dynamic held-out rule, and are not among the staged no-source-tag candidates (tagger run 7's Freesound rows and their
test split); title, tags and description name none of the pilot labels or their near relatives. At most 4 sounds per
uploader, and the uploader is the fold group. These are tag-evidenced negatives (an uploader not naming a sound is weak
evidence it is absent), so each row says which labels it is a negative for and why.
"""
import csv, hashlib, json, os, re, subprocess, sys, io
from collections import Counter, defaultdict
import pyarrow.parquet as pq

EXCL, NOSRC, OUT, *SHARDS = sys.argv[1:]
os.makedirs(os.path.join(OUT, 'audio'), exist_ok=True)
sets = json.load(open(EXCL))['sets']
bad_ids = set(sets['freesoundIds']) | set(sets['heldoutFreesoundIds']) | set(sets['reservedFreesoundIds'])
bad_users = {u.casefold() for k in ('freesoundUploaders', 'heldoutFreesoundUploaders', 'reservedFreesoundUploaders', 'freesoundUploadersCasefold') for u in sets[k]}
for r in csv.DictReader(open(NOSRC)):
    bad_ids.add(str(r['freesound_id'])); bad_users.add(r['username'].casefold())
h8 = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
def dynamic_reserved(u):
    return (h8('synth-fresh-up|freesound-user:' + u) % 5 == 0 or h8('dj-effects|' + u) % 4 == 0
            or h8('dge-audio-model-freesound-test|' + u) % 10 == 0)

# Words that make a sound unusable as a negative for every pilot label (it might be one).
ANY = r'laser|lazer|zap|pew|blaster|phaser|ray ?gun|sci-?fi|scifi|bass|guitar|impact|hit|knock|punch|slam|thud|bang|smash|crash|clank|clink|footstep|foley|drop|thump|tap|strike|whack|slap|kick|snare|drum|perc'
MUSIC = r'music|song|loop|beat|band|melody|track|bpm|chord|riff|groove|jam|instrumental'

rows, per_user, why = [], Counter(), Counter()
for path in SHARDS:
    t = pq.read_table(path)
    for i in range(t.num_rows):
        r = {c: t.column(c)[i].as_py() for c in ('title', 'description', 'tags', 'username', 'freesound_id', 'license', 'attribution_required', 'commercial_use')}
        fid, user = str(r['freesound_id']), r['username']
        if (r['license'], r['attribution_required'], r['commercial_use']) != (0, 0, 1): why['not CC0'] += 1; continue
        if fid in bad_ids: why['ID in DGE exclusion sets or run 7 candidates'] += 1; continue
        if user.casefold() in bad_users: why['uploader in DGE exclusion sets or run 7 candidates'] += 1; continue
        if dynamic_reserved(user): why['uploader under a dynamic held-out rule'] += 1; continue
        text = ' '.join([r['title'] or '', r['description'] or '', ' '.join(r['tags'] or [])]).lower()
        if re.search(ANY, text): why['text names a pilot label or near relative'] += 1; continue
        if per_user[user] >= 4: why['uploader cap (4)'] += 1; continue
        music = bool(re.search(MUSIC, text))
        audio = t.column('audio')[i].as_py()['bytes']
        wav = os.path.join(OUT, 'audio', f'{fid}.wav')
        p = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', 'pipe:0', '-t', '10', '-ac', '1', '-ar', '48000', wav], input=audio, capture_output=True)
        if p.returncode or not os.path.exists(wav): why['undecodable'] += 1; continue
        pcm = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
        per_user[user] += 1
        rows.append({'id': f'fs{fid}', 'freesound_id': fid, 'uploader': user, 'original_url': f'https://freesound.org/people/{user}/sounds/{fid}/',
                     'mirror': 'https://huggingface.co/datasets/benjamin-paine/freesound-laion-640k', 'license': 'CC0-1.0 (per mirror metadata; recheck the original page before any redistribution)',
                     'title': (r['title'] or '')[:120], 'music': music, 'duration_s': round(len(pcm) / 32000, 3),
                     'encoded_sha256': hashlib.sha256(audio).hexdigest(), 'pcm16k_sha256': hashlib.sha256(pcm).hexdigest(),
                     'bass guitar': 0 if not music else '', 'foley hit': 0, 'laser': 0,
                     'label_evidence': 'uploader title/tags/description name no pilot label or relative' + ('; music, so bass guitar unknown' if music else ''),
                     'review_status': 'tag-evidenced negative (not listened)', 'fold_group': f'freesound:{user}', 'split': 'train',
                     'transformations': 'first 10 s, mono 48 kHz WAV', 'path': wav})
with open(os.path.join(OUT, 'negatives.csv'), 'w', newline='') as f:
    fields = ['id', 'freesound_id', 'uploader', 'original_url', 'mirror', 'license', 'title', 'music', 'duration_s', 'encoded_sha256',
              'pcm16k_sha256', 'bass guitar', 'foley hit', 'laser', 'label_evidence', 'review_status', 'fold_group', 'split',
              'transformations', 'path']
    w = csv.DictWriter(f, fields); w.writeheader(); w.writerows(rows)
summary = {'kept': len(rows), 'uploaders': len(per_user), 'music': sum(r['music'] for r in rows), 'dropped': why}
json.dump(summary, open(os.path.join(OUT, 'summary.json'), 'w'), indent=1)
print(json.dumps(summary, indent=1))
