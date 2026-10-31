"""Pick rimshot / supersaw training clips (positives, hard negatives, background) from the freesound-laion-640k mirror
index, never touching a test clip or test uploader (private exclude list + finder additions + reserved-uploader rules +
repo reserved-test-families). Usage: select.py <mirror-index.jsonl> <exclude-lists.json> <exclude-additions.json> <repo> <out.json>"""
import json, sys, re, glob, hashlib, random
IDX, EXC, ADD, REPO, OUT = sys.argv[1:6]
ex = json.load(open(EXC))
bad_ids = set(map(str, ex['freesoundIds'])) | set(map(str, json.load(open(ADD))['freesoundIds']))
bad_users = {str(u).split(':', 1)[-1] for u in ex['freesoundUploaders']}
for f in glob.glob(f'{REPO}/docs/evaluations/*/reserved-test-families.json'):
    d = json.load(open(f)); bad_ids |= set(map(str, d.get('freesoundIds', [])))
    bad_users |= {str(u).split(':', 1)[-1] for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
rules = ex['reservedUploaderRule']['rules']
reserved = lambda u: any(int(hashlib.sha256((r['salt'] + u).encode()).hexdigest()[:8], 16) % r['mod'] == 0 for r in rules)
norm = lambda s: re.sub(r'[\s_\-]+', ' ', str(s or '').lower())
LOOP = re.compile(r'\b(loop|loops|beat|beats|song|track|full|mix|bpm|groove|pattern|break|music|melody)\b|\d{2,3} ?bpm')
RIM = re.compile(r'rim ?shot|rim ?click|side ?stick|cross ?stick|\brims?\b')
DRUM = re.compile(r'drum|snare|percussion|perc|hit|one ?shot|808|909|707|kit|stick')
HIT = re.compile(r'\b(snare|clap|clave|woodblock|wood block|tom|toms|hihat|hi hat|hat|cowbell|kick|block|stick|click|knock|tap|clank)\b')
JOKE = re.compile(r'ba ?dum|joke|sting|tss|table|glass|remix|roll|fill')
SAW = re.compile(r'super ?saw|detuned saw|supersaws|detuned sawtooth')
SYN = re.compile(r'\b(synth|synthesizer|pad|lead|pluck|arp|arpeggio|chord|chords|stab|bass|sine|square|organ|piano|strings)\b')
ANYSAW = re.compile(r'\bsaw|sawtooth|trance|hoover|detune')
rim, rimneg, saw, synneg, bg, dropped = [], [], [], [], [], 0
kind_of = {}
for line in open(IDX):
    r = json.loads(line); i, u = str(r['freesound_id']), str(r['username'])
    if i in bad_ids or u in bad_users or reserved(u): dropped += 1; continue
    txt = norm(r['title']) + ' | ' + norm(' '.join(r['tags'] or []))
    c = {'id': f'fs-{i}', 'freesoundId': int(i), 'username': u, 'group': u, 'title': r['title'], 'file': r['file'], 'row': r['row']}
    loop = LOOP.search(txt)
    if RIM.search(txt):
        if not loop and DRUM.search(txt) and not JOKE.search(txt): rim.append(c); kind_of[c['id']] = 'rimshot'
        continue
    if SAW.search(txt): saw.append(c); kind_of[c['id']] = 'supersaw'; continue
    if HIT.search(txt) and not loop: rimneg.append(c); kind_of[c['id']] = 'drum-hit'; continue
    if SYN.search(txt) and not ANYSAW.search(txt): synneg.append(c); kind_of[c['id']] = 'synth'; continue
    if not ANYSAW.search(txt): bg.append(c); kind_of[c['id']] = 'background'
def cap(cs, n, per=5, seed=0):
    random.Random(seed).shuffle(cs); seen, out = {}, []
    for c in cs:
        if seen.get(c['username'], 0) < per: seen[c['username']] = seen.get(c['username'], 0) + 1; out.append(c)
    return out[:n]
rimneg0, synneg0, bg0 = list(rimneg), list(synneg), list(bg)
rim, saw = cap(rim, 600, per=8), cap(saw, 300, per=8, seed=3)
rimneg, synneg, bg = cap(rimneg, 900, seed=1), cap(synneg, 900, seed=4), cap(bg, 1500, per=3, seed=2)
for c in rim: c['labels'] = ['rimshot']
for c in saw: c['labels'] = ['supersaw']
for k, cs in (('drum-hit', rimneg), ('synth', synneg), ('background', bg)):
    for c in cs: c['labels'] = []; c['kind'] = k
u = lambda cs: len({c['username'] for c in cs})
print(f'dropped (test ids/uploaders/reserved): {dropped}; rimshot {len(rim)} ({u(rim)} uploaders), supersaw {len(saw)} ({u(saw)}), '
      f'drum-hit negatives {len(rimneg)}, synth negatives {len(synneg)}, background {len(bg)}')
pool = {c['id']: dict(c, kind=kind_of[c['id']]) for c in rimneg0 + synneg0 + bg0}
json.dump({'kind': 'rimshot-supersaw-candidates-v1', 'clips': rim + saw, 'pool': list(pool.values())}, open(OUT, 'w'))
