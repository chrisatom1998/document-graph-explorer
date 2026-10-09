"""Grows the DJ-effect clip set: keeps every clip of an earlier round (same ids, labels and splits) and adds the clips a
larger mine.py run picked that the earlier round did not have.

The split rule is mine.py's (by uploader hash), so an uploader held out before is still held out, and a new clip from a
held-out uploader joins the held-out side. Each clip records the round that first added it ("round"), so the held-out
clips of round 1 can still be scored on their own and compared with the heads trained on round 1 (PR #141).
Usage: grow.py <earlier clips.json> <larger candidates.json> <out candidates.json> <round number>"""
import json, sys, hashlib
BASE, BIG, OUT, ROUND = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
heldout = lambda user: int(hashlib.sha256(f'dj-effects|{user}'.encode()).hexdigest()[:8], 16) % 4 == 0

base = json.load(open(BASE))['clips']
big = json.load(open(BIG))
have = {c['freesoundId'] for c in base}
clips = []
for c in base:
    assert c['split'] == ('heldout' if heldout(c['username']) else 'train'), f"split rule changed for {c['id']}"
    clips.append({**c, 'group': f"uploader:{c['username']}", 'round': c.get('round', ROUND - 1)})
new = [{**c, 'round': ROUND} for c in big['clips'] if c['freesoundId'] not in have]
clips += new
users = lambda s: {c['username'] for c in clips if c['split'] == s}
assert not users('train') & users('heldout'), 'uploader in both splits'
json.dump({**{k: v for k, v in big.items() if k != 'clips'}, 'kind': 'dj-effects-candidates-v2', 'round': ROUND,
           'clips': sorted(clips, key=lambda c: c['freesoundId'])}, open(OUT, 'w'), indent=1)
count = lambda rows, s: sum(c['split'] == s for c in rows)
print(f"round {ROUND - 1}: {len(base)} clips ({count(base, 'heldout')} held out); added {len(new)} ({count(new, 'heldout')} held out); "
      f"total {len(clips)}")
