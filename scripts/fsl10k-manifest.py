"""Turns FSL10K into training clips. People listened to each loop and ticked which of six things
it contains (percussion, bass, chords, melody, fx, vocal), so a loop also says what it does NOT
contain - real-recording evidence of absence, which file names can never give. Only loops where
the listeners agreed are kept, and only the four ticks that name a catalog sound.
The Freesound uploader is the split key.
Usage: fsl10k-manifest.py <fsl10k extract dir> <out manifest.json>"""
import json, sys, glob, os, re, collections
ROOT, OUT = sys.argv[1:3]
TICK = {'percussion': 'drums', 'vocal': 'voice', 'fx': 'sound effect'}   # the ticks that name a catalog source
votes = collections.defaultdict(lambda: collections.defaultdict(list))
for f in glob.glob(f'{ROOT}/annotations/*/sound-*.json'):
    d = json.load(open(f))
    if d.get('discard'): continue
    sid = re.search(r'sound-(\d+)\.json', f).group(1)
    for tick, label in TICK.items():
        if tick in d.get('instrumentation', {}): votes[sid][label].append(bool(d['instrumentation'][tick]))
meta = json.load(open(f'{ROOT}/metadata.json'))
audio = {os.path.basename(p).split('_')[0]: p for p in glob.glob(f'{ROOT}/audio/wav/*.wav')}
clips, dropped = [], 0
for sid, per_label in votes.items():
    if sid not in audio: continue
    # Keep a loop only where every listener agreed about every sound.
    if any(len(set(v)) > 1 for v in per_label.values()): dropped += 1; continue
    labels = sorted(l for l, v in per_label.items() if v[0])
    user = (meta.get(sid) or {}).get('username') or f'sound{sid}'
    clips.append({'id': f'fsl10k:{sid}', 'path': audio[sid], 'labels': labels, 'group': f'fsl10k:{user}'})
print(f'{len(clips)} loops kept, {dropped} dropped for disagreement')
print(dict(collections.Counter(l for c in clips for l in c['labels'])), f"{sum(not c['labels'] for c in clips)} with none of them")
json.dump({'kind': 'fsl10k-v1', 'clips': clips}, open(OUT, 'w'))
