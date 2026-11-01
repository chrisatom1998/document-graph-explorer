"""Shared rules for the round A/B/C staging jobs (stage-birds.py, stage-guitarfx.py, ced-check-keys-breaks.py) and their
prepare scripts. The split, label and exclusion rules are pure functions, so test_round_abc.py checks them on CPU with no
network; only the download helpers, freesound_exclusions() and require_private() go online.

Every staged clip gets one manifest row: where it came from (url), its licence, checksums of the original file, of its
decoded audio and of the staged copy, its label evidence, its group (the performer, guitar, recording or uploader that
must stay on one side) and its split. A split is decided per group, never per clip, so related clips never straddle
train and test. Exact duplicate audio (same decoded samples) is kept once, on the side its first copy landed on; a
duplicate whose group disagrees is dropped from both sides.
"""
import csv, glob, hashlib, io, json, os, re, subprocess, tarfile, time, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RATE = 32000
UA = {'User-Agent': 'Mozilla/5.0 (DGE research; dataset staging)'}
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
COLUMNS = ['id', 'dataset', 'url', 'licence', 'original_sha256', 'pcm_sha256', 'file', 'staged_sha256', 'seconds',
           'group', 'split', 'tags', 'absent', 'label_evidence']


def bucket(salt, group, n=100):
    """A stable number in [0, n) for a group."""
    return int(h(salt, group)[:8], 16) % n


def group_split(group, salt, held_pct, val_pct):
    """'heldout', 'val' or 'train' for a whole group: held_pct of groups are test, val_pct of the rest validation."""
    b = bucket(salt, group)
    if b < held_pct: return 'heldout'
    return 'val' if bucket(salt + ':val', group) < val_pct else 'train'


def reserved_lists(root=ROOT):
    """Union of every docs/evaluations/*/reserved-test-families.json: {key: set(values)}. Freesound ids become ints and
    uploaders lose their 'freesound-user:' prefix, so callers compare plain values."""
    out = {}
    files = sorted(glob.glob(os.path.join(root, 'docs', 'evaluations', '*', 'reserved-test-families.json')))
    if not files: raise SystemExit('no reserved-test-families.json found; refusing to stage without the reserved test lists')
    for f in files:
        for k, v in json.load(open(f)).items():
            if not isinstance(v, list): continue
            vals = out.setdefault(k, set())
            for x in v:
                if isinstance(x, str): x = x.removeprefix('freesound-user:')
                if k == 'freesoundIds': x = int(x)
                vals.add(x)
    out['_files'] = {os.path.relpath(f, root) for f in files}
    return out


def commercial_packs(root=ROOT):
    """Pack names in datasets/commercial-split/packs.csv (None when the file is not in this checkout)."""
    p = os.path.join(root, 'datasets', 'commercial-split', 'packs.csv')
    if not os.path.isfile(p): return None
    rows = list(csv.DictReader(open(p)))
    return {(r.get('pack') or r.get('name') or next(iter(r.values()), '') or '').strip().lower() for r in rows} - {''}


def check_not_a_pack(dataset_names, root=ROOT):
    """Stops when a staged dataset is a listed commercial pack; returns a note for the log."""
    packs = commercial_packs(root)
    if packs is None: return 'datasets/commercial-split/packs.csv is not in this checkout; no pack can match a public dataset'
    hit = {d for d in dataset_names if d.lower() in packs}
    if hit: raise SystemExit(f'refusing: {sorted(hit)} listed in datasets/commercial-split/packs.csv')
    return f'none of {sorted(dataset_names)} is in packs.csv ({len(packs)} packs)'


def forbidden_set_names(root=ROOT):
    return json.load(open(os.path.join(root, 'scripts', 'hf-sound-tags', 'config.json')))['forbiddenSets']


def pcm(data, secs=None, rate=RATE):
    """Any audio file's bytes -> mono int16 PCM bytes at `rate` (all of it unless secs), or None."""
    cmd = ['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0'] + (['-t', str(secs)] if secs else []) + ['-ac', '1', '-ar', str(rate), '-f', 's16le', 'pipe:1']
    try: out = subprocess.run(cmd, input=data, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError: return None
    return out or None


def encode(pcm_bytes, codec='flac', rate=RATE):
    """int16 mono PCM -> staged file bytes (flac, or ogg/opus at 96 kbit/s)."""
    args = ['-c:a', 'flac', '-f', 'flac'] if codec == 'flac' else ['-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg']
    return subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 's16le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0', *args, 'pipe:1'],
                          input=pcm_bytes, capture_output=True, check=True).stdout


class Dedup:
    """Exact duplicate audio, by sha256 of the decoded samples. add() returns None for a new clip, or the reason to drop it."""
    def __init__(self): self.seen = {}; self.conflicts = set()
    def add(self, pcm_sha, group, split):
        prev = self.seen.get(pcm_sha)
        if prev is None: self.seen[pcm_sha] = (group, split); return None
        if prev[1] != split or prev[0] != group: self.conflicts.add(pcm_sha); return 'duplicate audio in another group'
        return 'duplicate audio'


def drop_conflicts(rows, dedup):
    """Rows whose audio also appears in another group are dropped from every side."""
    return [r for r in rows if r['pcm_sha256'] not in dedup.conflicts]


def check_groups(rows):
    """Every group sits wholly on the held-out side or wholly on the training side (train and val count as one side,
    since validation only picks thresholds); raises otherwise. Returns the number of groups."""
    side = {}
    for r in rows:
        s = 'heldout' if r['split'] == 'heldout' else 'train'
        if side.setdefault(r['group'], s) != s: raise SystemExit(f"group {r['group']} is on both sides of the held-out split")
    return len(side)


class Md5Reader(io.RawIOBase):
    """Wraps a download so its md5 is checked at the end of the stream."""
    def __init__(self, f): self.f, self.md5, self.n = f, hashlib.md5(), 0
    def readable(self): return True
    def readinto(self, b):
        d = self.f.read(len(b)); self.md5.update(d); self.n += len(d); b[:len(d)] = d; return len(d)


def remote_size(url):
    with urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers=UA), timeout=120) as r: return int(r.headers['Content-Length'])


def _get_range(url, a, b, tries=8):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, 'Range': f'bytes={a}-{b}'}), timeout=300) as r:
                if r.status != 206: raise OSError(f'HTTP {r.status} (no range support)')
                d = r.read()
            if len(d) != b - a + 1: raise OSError(f'short read {len(d)} of {b - a + 1}')
            return d
        except Exception as e:
            if i == tries - 1: raise
            print(f'  retry {a}-{b}: {e}', flush=True); time.sleep(5 * (i + 1))


def fetch_ranges(url, path, start=0, length=None, conns=16, chunk=32 << 20):
    """Downloads bytes [start, start+length) of url to path with `conns` parallel range requests. Zenodo serves about
    1 MB/s per connection, so one stream of an 8 GB archive would take over two hours. Returns the md5 of what was written."""
    if length is None: length = remote_size(url) - start
    with open(path, 'wb') as f: f.truncate(length)
    fd = os.open(path, os.O_WRONLY)
    def one(off):
        os.pwrite(fd, _get_range(url, start + off, start + min(length, off + chunk) - 1), off); return off
    t0, done = time.time(), 0
    try:
        with ThreadPoolExecutor(conns) as pool:
            for _ in pool.map(one, range(0, length, chunk)):
                done += 1
                if done % 32 == 0: print(f'  {os.path.basename(path)}: {done * chunk >> 20} of {length >> 20} MB, {done * chunk / 1e6 / (time.time() - t0):.1f} MB/s', flush=True)
    finally: os.close(fd)
    md5 = hashlib.md5()
    with open(path, 'rb') as f:
        while d := f.read(1 << 24): md5.update(d)
    return md5.hexdigest()


class Stager:
    """Decodes, hashes, dedups and encodes clips into <out>/audio-NNN.tar shards (about 800 MB each, as stage-run9.py
    does, so the private repo gets a few large files rather than thousands of small ones). work() runs in a thread
    pool; keep() applies dedup in arrival order and writes the shard."""
    SHARD = 800 << 20
    def __init__(self, out, dry, codec='flac'):
        self.out, self.dry, self.codec, self.ext = out, dry, codec, 'flac' if codec == 'flac' else 'opus'
        self.rows, self.dedup, self.drop, self.shard, self.k, self.size = [], Dedup(), Counter(), None, 0, 0
    def work(self, item):
        row, data = item
        audio = pcm(data)
        if audio is None or len(audio) < RATE // 2: return row, None
        staged = b'' if self.dry else encode(audio, self.codec)
        return dict(row, original_sha256=hashlib.sha256(data).hexdigest(), pcm_sha256=hashlib.sha256(audio).hexdigest(),
                    staged_sha256=hashlib.sha256(staged).hexdigest() if staged else '', seconds=round(len(audio) / 2 / RATE, 3)), staged
    def keep(self, done):
        row, staged = done
        if staged is None: self.drop['undecodable or under 0.25 s'] += 1; return
        why = self.dedup.add(row['pcm_sha256'], row['group'], row['split'])
        if why: self.drop[why] += 1; return
        name = f"{row['id'].replace(':', '_').replace('/', '_')}.{self.ext}"
        if not self.dry:
            if self.shard is None or self.size > self.SHARD:
                if self.shard: self.shard.close()
                self.shard = tarfile.open(os.path.join(self.out, f'audio-{self.k:03d}.tar'), 'w'); self.k += 1; self.size = 0
            ti = tarfile.TarInfo(name); ti.size = len(staged); ti.mtime = 0
            self.shard.addfile(ti, io.BytesIO(staged)); self.size += len(staged)
        self.rows.append(dict(row, file=f'audio-{self.k - 1:03d}.tar/{name}'))
    def run(self, pool, items, chunk=256):
        items = iter(items)
        while batch := [x for _, x in zip(range(chunk), items)]:
            for done in pool.map(self.work, batch): self.keep(done)
    def finish(self):
        """Closes the last shard and drops rows whose audio also sits in another group (from every side). Their bytes
        stay inside the private shard but no manifest row points at them, so no prepare script can read them."""
        if self.shard: self.shard.close(); self.shard = None
        return drop_conflicts(self.rows, self.dedup)


def iter_shards(stage_dir):
    """(file column value, bytes) for every clip in a staged folder's tar shards, one shard at a time."""
    for t in sorted(glob.glob(os.path.join(stage_dir, 'audio-*.tar'))):
        with tarfile.open(t) as tf:
            for m in tf:
                if m.isfile(): yield f'{os.path.basename(t)}/{m.name}', tf.extractfile(m).read()


def write_manifest(rows, path):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, COLUMNS); w.writeheader()
        for r in rows: w.writerow({k: r.get(k, '') for k in COLUMNS})


def require_private(api, repo):
    if not api.repo_info(repo, repo_type='dataset').private: raise SystemExit(f'{repo} is not private; refusing to upload')


# ---- label maps: (present, absent) plain tag names; anything in neither is unknown and left unlabelled ----

MEDLEY = {'clarinet': ['clarinet'], 'distorted electric guitar': ['electric guitar', 'guitar', 'distorted'], 'female singer': ['voice'],
          'flute': ['flute'], 'piano': ['piano'], 'tenor saxophone': ['saxophone'], 'trumpet': ['trumpet'], 'violin': ['violin / fiddle']}
MEDLEY_TAUGHT = sorted({t for v in MEDLEY.values() for t in v})


def medley_labels(instrument):
    """Medley-solos-DB clips are solo recordings of one instrument, so every other taught instrument is a sure absence.
    'distorted' is taught only as present (distorted guitar) or absent (the acoustic solo instruments)."""
    present = set(MEDLEY[instrument])
    return sorted(present), sorted(set(MEDLEY_TAUGHT) - present)


IDMT_TAUGHT = ['dry', 'chorused', 'flanged', 'reverberant', 'echoing', 'saturated', 'distorted', 'guitar', 'electric guitar']
IDMT_EFFECT = {'NoFX': ['dry'], 'Chorus': ['chorused'], 'Flanger': ['flanged'], 'Reverb': ['reverberant'],
               'FeedbackDelay': ['echoing'], 'SlapbackDelay': ['echoing'], 'Distortion': ['distorted'], 'Overdrive': ['saturated'],
               'Phaser': [], 'Tremolo': [], 'Vibrato': [], 'EQ': []}
# Effects the tag list has no name for: say only what is surely absent. A phaser can sound flanged or chorused, and
# vibrato like chorus, so those stay unknown; tremolo is left unknown for everything but drive and dryness. 'EQ' is a
# folder the dataset description does not list (1248 mono + 840 poly guitar clips): a filter is not a time effect or
# drive, so only 'dry' is unknown for it.
IDMT_UNKNOWN = {'Distortion': ['saturated'], 'Overdrive': ['distorted'], 'Phaser': ['chorused', 'flanged', 'reverberant', 'echoing'],
                'Tremolo': ['chorused', 'flanged', 'reverberant', 'echoing'], 'Vibrato': ['chorused', 'flanged', 'reverberant', 'echoing'],
                'EQ': ['dry']}


def idmt_labels(effect):
    """EGFxSet's convention: overdrive = saturated and distortion = distorted, each leaving the other unknown."""
    present = set(IDMT_EFFECT[effect]) | {'guitar', 'electric guitar'}
    absent = set(IDMT_TAUGHT) - present - set(IDMT_UNKNOWN.get(effect, []))
    return sorted(present), sorted(absent)


IDMT_NAME = re.compile(r'^([BGP])(\d)(\d)-(\d{5})-(\d{4})-(\d+)\.wav$')


def idmt_parse(path):
    """'Gitarre monophon/Samples/Distortion/G81-60501-3323-31566.wav' -> dict, or None for anything that is not a clip.
    Name fields (dataset description): instrument (B bass, G mono guitar, P poly guitar), instrument setting
    (pickup/guitar 6-9), play style, then the note, the effect group/type/setting and the file number."""
    parts = path.replace('\\', '/').split('/')
    m = IDMT_NAME.match(parts[-1])
    if not m or len(parts) < 2: return None
    kind, setting, style, note, fx, num = m.groups()
    return {'kind': kind, 'setting': int(setting), 'style': style, 'note': note, 'fx': fx, 'num': num, 'effect': parts[-2], 'file': parts[-1]}


def idmt_guitar(setting):
    """Instrument settings 6-7 = guitar 1, 8-9 = guitar 2 (two guitars x two pickup settings; see README). Checked
    2026-10-31: mono guitar zips use 6/7/8/9 evenly and the poly zips (one take per guitar) only 6 and 9, which fits
    this pairing; the XML lists do not name the guitar, so 6+7 vs 6+8 stays an assumption."""
    if setting not in (6, 7, 8, 9): raise ValueError(f'unexpected IDMT instrument setting {setting}')
    return 'guitar-1' if setting in (6, 7) else 'guitar-2'


def bird_labels(hasbird):
    """hasbird=1: a bird is audible, so bird ambience and animal sound are present. hasbird=0 says no bird; other
    animals may still be there, so animal sound stays unknown."""
    return (['animal sound', 'bird ambience'], []) if int(hasbird) else ([], ['bird ambience'])


FREESOUND_URL = re.compile(r'freesound\.org/(?:people/([^/]+)/)?sounds/(\d+)')


def freesound_ref(url):
    """(uploader or None, sound id or None) from a freesound.org url."""
    m = FREESOUND_URL.search(url or '')
    return (m.group(1), int(m.group(2))) if m else (None, None)


# ---- Freesound exclusions (birds: ff1010bird ids are Freesound ids; job C: Freesound candidates) ----

synth_held = lambda user: int(h('synth-fresh-up', f'freesound-user:{user}')[:8], 16) % 5 == 0   # as prepare-freesound.py
fs_test = lambda user: int(h('dge-audio-model-freesound-test', user)[:8], 16) % 10 == 0         # as stage-freesound.py
EXCLUSION_KEYS = ('fsd_eval', 'fsd_dev', 'reserved_ids', 'reserved_users', 'cached_train', 'cached_test', 'trained_ids', 'held_users', 'held_ids', 'extra_ids')


def freesound_reason(sid, user, ex, side):
    """Why a Freesound sound may not be used on `side` ('train' or 'heldout'), or None. `ex` has EXCLUSION_KEYS sets:
    test and judge material never trains, and a new held-out clip must not be something any source already trains on."""
    if user is None: return 'no uploader metadata'
    if sid in ex['fsd_eval']: return 'FSD50K eval'
    if sid in ex['reserved_ids']: return 'reserved test sound'
    if user in ex['reserved_users'] or synth_held(user): return 'reserved test uploader'
    if sid in ex['cached_test'] or fs_test(user): return 'cached Freesound test'
    if sid in ex['held_ids'] or user in ex['held_users']: return 'uploader has a held-out clip in another set'
    if side == 'heldout' and (sid in ex['fsd_dev'] or sid in ex['cached_train'] or sid in ex['trained_ids'] or sid in ex['extra_ids']):
        return 'already trained elsewhere'
    return None


def manifest_refs(rows):
    """(all ids, held-out ids, held-out uploaders) from a staged manifest's rows: Freesound ids come from a url column,
    a 'freesoundId' or an id like 'fsnew:123'; uploaders from a url or a username column."""
    ids, held_ids, held_users = set(), set(), set()
    for r in rows:
        u, sid = freesound_ref(r.get('url', ''))
        sid = sid or r.get('freesoundId')
        if sid is None:
            m = re.match(r'^(?:(?:fs\w*|freesound|ff1010bird):)?(\d+)$', str(r.get('id', '')).split('@')[0])
            sid = int(m.group(1)) if m else None
        u = u or r.get('username') or (str(r.get('group', '')).removeprefix('freesound-user:') if str(r.get('group', '')).startswith('freesound-user:') else None)
        if sid is None: continue
        ids.add(int(sid))
        if r.get('split') in ('heldout', 'test'):
            held_ids.add(int(sid))
            if u: held_users.add(u)
    return ids, held_ids, held_users


def freesound_exclusions(me='cmjatom', private='cmjatom/dge-private-train', cache_key='cb691f46e32e', extra_ids=()):
    """Downloads every list freesound_reason() needs (needs a token that reads the private repos). Returns (ex, users)
    where users maps Freesound id -> uploader."""
    import pyarrow.parquet as pq
    from huggingface_hub import HfApi, hf_hub_download
    meta = pq.read_table(hf_hub_download('Chr0my/freesound.org', 'freesound_parquet.parquet', repo_type='dataset'), columns=['id', 'username']).to_pydict()
    users = {int(i): u for i, u in zip(meta['id'], meta['username'])}
    fsd = lambda f: {int(r['fname']) for r in csv.DictReader(open(hf_hub_download('Fhrozen/FSD50k', f'labels/{f}.csv', repo_type='dataset')))}
    res = reserved_lists()
    cache = lambda f: json.load(open(hf_hub_download(f'{me}/dge-tagger-data', f, repo_type='dataset')))['items']
    ex = {'fsd_eval': fsd('eval'), 'fsd_dev': fsd('dev'), 'reserved_ids': res.get('freesoundIds', set()),
          'reserved_users': res.get('freesoundUploaders', set()) | res.get('fsdUploaders', set()),
          'cached_train': {int(i['id'].split(':')[1]) for i in cache(f'prep-cache/{cache_key}/fsprep/freesound.json')},
          'cached_test': {int(i['id'].split(':')[1]) for i in cache(f'prep-cache/{cache_key}/fsprep/eval-freesound.json')},
          'trained_ids': set(), 'held_users': set(), 'held_ids': set(), 'extra_ids': set(map(int, extra_ids))}
    for i in cache(f'prep-cache/{cache_key}/fsprep/eval-freesound.json'):
        if str(i.get('artist', '')).startswith('freesound-user:'): ex['held_users'].add(i['artist'].removeprefix('freesound-user:'))
    manifests = [f for f in HfApi().list_repo_files(private, repo_type='dataset')
                 if f.endswith('manifest.csv') and f.startswith(('freesound/', 'run9/', 'birds/'))]
    for f in manifests:
        ids, hid, hus = manifest_refs(csv.DictReader(open(hf_hub_download(private, f, repo_type='dataset'))))
        ex['trained_ids'] |= ids - hid; ex['held_ids'] |= hid; ex['held_users'] |= hus
    for f in sorted(glob.glob(os.path.join(ROOT, 'docs', 'evaluations', 'dj-effects-*', 'clips.json'))):
        for c in json.load(open(f))['clips']:
            if c.get('split') == 'train': ex['trained_ids'].add(int(c['freesoundId']))
            else: ex['held_ids'].add(int(c['freesoundId'])); ex['held_users'].add(c['username'])
    ex['_sources'] = {'manifests': manifests, 'cacheKey': cache_key}
    return ex, users


def eval_pick(rows, tag, cap, salt='dge-eval-pick'):
    """At most cap held-out rows, half with `tag` present and half absent where possible, lowest hash first."""
    pos = sorted((r for r in rows if tag in r['tags'].split(';')), key=lambda r: h(salt, r['id']))
    neg = sorted((r for r in rows if tag in r['absent'].split(';')), key=lambda r: h(salt, r['id']))
    k = min(len(pos), cap // 2); pos = pos[:k]; neg = neg[:cap - k]
    return pos + neg


def reserved_group(row, res):
    """True when a staged row's group belongs to a reserved test family (docs/evaluations/*/reserved-test-families.json)."""
    group = row['group']
    if group.startswith('medley-song:'): return group.split(':', 1)[1] in res.get('medleySolosHeldoutSongIds', set())
    if group.startswith('idmt-guitar-'):
        return bool(res.get('idmtAudioEffectsHeldoutInstrumentSettings', set()) & ({8, 9} if group == 'idmt-guitar-2' else {6, 7}))
    if group.startswith('freesound-user:') and group.split(':', 1)[1] in res.get('freesoundUploaders', set()) | res.get('fsdUploaders', set()): return True
    if row.get('dataset') in ('ff1010bird', 'warblr10k'):
        rule = json.load(open(os.path.join(ROOT, 'docs', 'evaluations', 'bird-heldout-2026-10-31', 'reserved-test-families.json')))['birdHeldoutRule']
        return bucket(rule['salt'], group) < rule['heldPct']
    return False


def assert_reserved_held(rows, res=None):
    """No train/val row may come from a reserved group; raises otherwise."""
    res = res or reserved_lists()
    bad = sorted({r['group'] for r in rows if r['split'] != 'heldout' and reserved_group(r, res)})
    if bad: raise SystemExit(f'{len(bad)} reserved test groups on the training side, e.g. {bad[:3]}')
