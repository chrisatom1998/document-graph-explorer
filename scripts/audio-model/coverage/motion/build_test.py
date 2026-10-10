"""Assemble the TEST ONLY folder datasets/test-motion-tags/ from the fetched held-out clips (no network).

Usage: python3 -I build_test.py <sel-dir> <fetched-dir> <mirror-meta.parquet> <out-dir>
  <sel-dir>/test-picks.csv (select_clips.py), <fetched-dir>/<id>.flac + fetched.jsonl (fetch_mirror.py)
Writes manifest.csv, eval-motion.json (H positives + keyword-free negatives), eval-motion-pending.json (M clips,
scored only once Chris says yes in listen-list.csv / listen-answers.csv), listen-list.csv, listen-audio/<id>.mp3
(first 30 s, mono 96 kbps), audio/<id>.flac (16 kHz mono, <= 30 s), training-exclusions.json, summary.json.
Labels: an H or confirmed clip is present for its own tag only; the other motion tags stay unknown (a drum loop can be
rhythmic, percussive and syncopated at once). A negative is absent for all nine motion tags.
"""
import csv, hashlib, json, os, shutil, subprocess, sys
from collections import Counter, defaultdict
import numpy as np
import pyarrow.parquet as pq
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keywords import TAGS

SEL, FET, META, OUT = sys.argv[1:5]
LICN = {0: 'CC0', 1: 'CC BY 4.0', 2: 'CC BY 3.0', 3: 'CC BY-NC 3.0', 4: 'CC BY-NC 4.0', 5: 'CC Sampling+'}
# Hand review of the word picks (2026-10-10): titles whose words name the tag only in passing, or name an object
# rather than a sound's motion, go to the listen list instead of straight into the scored set.
DEMOTE = {576976, 211822, 561266, 128142, 237267, 506785, 613096, 517433, 583733, 388132, 527289, 366889, 527620,
          130181, 140787, 608729, 269098, 571425, 245330, 213147, 97845, 321556}
for d in ('audio', 'listen-audio'): os.makedirs(f'{OUT}/{d}', exist_ok=True)
t = pq.read_table(META, columns=['freesound_id', 'title', 'tags', 'username', 'license']).to_pydict()
meta = {}
for i, ti, tg, u, l in zip(t['freesound_id'], t['title'], t['tags'], t['username'], t['license']):
    meta.setdefault(int(i), dict(title=ti or '', tags=','.join(tg or []), user=u or '', lic=LICN.get(l, 'unknown')))
fetched = {int(j['id']): j for j in map(json.loads, open(f'{FET}/fetched.jsonl'))}
picks = list(csv.DictReader(open(f'{SEL}/test-picks.csv')))
ANS = {}
if os.path.exists(f'{OUT}/listen-answers.csv'):
    ANS = {int(r['freesound_id']): r['answer'].strip().lower() for r in csv.DictReader(open(f'{OUT}/listen-answers.csv'))}

def pcm_md5(path):
    b = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', 'pipe:1'], capture_output=True).stdout
    return hashlib.md5(b).hexdigest(), len(b) / 2 / 16000, np.abs(np.frombuffer(b, np.int16)).max() if b else 0

items, seen = [], {}
def add(i, tag, conf, evidence):
    src = f'{FET}/{i}.flac'
    if i not in fetched or not os.path.exists(src): print('no audio', i); return
    md5, sec, peak = pcm_md5(src)
    if peak <= 30: print('silent', i); return
    if md5 in seen: print('duplicate audio', i, '=', seen[md5]); return
    seen[md5] = i
    shutil.copyfile(src, f'{OUT}/audio/{i}.flac')
    m = meta[i]
    items.append(dict(key=f'freesound:{i}', source='freesound', id=i, tag=tag or '(negative)', conf=conf, creator=m['user'],
                      url=f"https://freesound.org/people/{m['user']}/sounds/{i}/", licence=m['lic'], group=f"freesound-user:{m['user']}",
                      file=f'audio/{i}.flac', file_sha256=fetched[i]['encoded_sha256'], audio_md5=md5, seconds=round(sec, 2),
                      title=m['title'], evidence=evidence))

for p in picks:
    i = int(p['freesound_id']); conf = p['conf']
    if conf == 'H' and i in DEMOTE: conf = 'M'
    ev = f"uploader title/tags: {p['title']} | {p['tags'][:200]}"
    if conf == 'M' and ANS.get(i) == 'yes': conf = 'H'; ev += ' | confirmed by Chris listen check'
    elif conf == 'M' and ANS.get(i) == 'no': conf = 'X'
    add(i, p['tag'], conf, ev)
neg_users = {it['creator'] for it in items}   # a negative never shares an uploader with a positive or another negative
for i, j in sorted(fetched.items()):
    if j['role'] == 'negative' and meta[i]['user'] not in neg_users:
        neg_users.add(meta[i]['user']); add(i, None, 'N', 'negative: uploader title, tags and description use none of the motion words or music/instrument words')

def labels(it):
    if it['conf'] == 'N': return {f'cat:{t}': 'absent' for t in TAGS}
    return {f"cat:{it['tag']}": 'present'}
scored = [it for it in items if it['conf'] in ('H', 'N')]
pending = [it for it in items if it['conf'] == 'M']
json.dump({'source': 'held-out TEST clips for the motion tags (2026-10-10): reserved-uploader Freesound clips from the HF mirror benjamin-paine/freesound-laion-640k. TEST ONLY.',
           'items': [{'id': it['key'], 'artist': it['group'], 'file': it['file'], 'labels': labels(it)} for it in scored]}, open(f'{OUT}/eval-motion.json', 'w'), indent=0)
json.dump({'source': 'pending clips awaiting a listen check (not scored until confirmed)',
           'items': [{'id': it['key'], 'artist': it['group'], 'file': it['file'], 'labels': labels(it)} for it in pending]}, open(f'{OUT}/eval-motion-pending.json', 'w'), indent=0)
cols = ['key', 'source', 'id', 'tag', 'conf', 'creator', 'url', 'licence', 'group', 'file', 'file_sha256', 'audio_md5', 'seconds', 'title', 'evidence']
with open(f'{OUT}/manifest.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, cols); w.writeheader(); [w.writerow(it) for it in items]
with open(f'{OUT}/listen-list.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['tag', 'freesound_url', 'local_file', 'title', 'yes/no'])
    for it in sorted(pending, key=lambda it: (TAGS.index(it['tag']), it['id'])):
        mp3 = f"{OUT}/listen-audio/{it['id']}.mp3"
        if not os.path.exists(mp3):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f"{OUT}/{it['file']}", '-t', '30', '-ac', '1', '-b:a', '96k', mp3])
        w.writerow([it['tag'], it['url'], f"listen-audio/{it['id']}.mp3", it['title'], ANS.get(it['id'], '')])
excl = {'rule': 'TEST ONLY: never train, tune or calibrate on anything below. Freesound uploaders are all under the reserved test-uploader hash rules (synth-clip test or cached Freesound test), which run 9 and later never train.',
        'freesound_ids': sorted(it['id'] for it in items), 'freesound_uploaders': sorted({it['creator'] for it in items}),
        'audio_md5': sorted(it['audio_md5'] for it in items), 'encoded_sha256': sorted(it['file_sha256'] for it in items)}
json.dump(excl, open(f'{OUT}/training-exclusions.json', 'w'), indent=1)
summ, groups = Counter(), defaultdict(set)
for it in items: summ[(it['tag'], it['conf'])] += 1; groups[(it['tag'], it['conf'])].add(it['group'])
json.dump({f'{t}|{c}': {'clips': n, 'uploaders': len(groups[(t, c)])} for (t, c), n in sorted(summ.items())}, open(f'{OUT}/summary.json', 'w'), indent=1)
print(json.dumps({f'{t}|{c}': n for (t, c), n in sorted(summ.items())}))
