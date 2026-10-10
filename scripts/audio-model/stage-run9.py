"""Stage tagger run 9's new training and held-out audio into a PRIVATE Hugging Face dataset (run as small CPU HF jobs).

  STAGE_REPO=<user>/dge-private-train OUT=run9/v1 PART=freesound NPARTS=3 PARTNO=0 IDS=run9/inputs/run9-ids.txt \
  IDS_MD5=<md5> REPO_SHA=<sha of this repo> python3 -I stage-run9.py
  PART=labelled stages the labelled sets instead (no id list needed).

Writes <OUT>/<part name>/ : manifest.csv (id, source, group, split, tags, licence, reviewed, score, route, url, file), audio-NNN.tar
(10 s or shorter mono 32 kHz FLAC per item, or the Freesound preview MP3), summary.json. Refuses to upload unless the repo
is private. Every item is unreviewed (nobody has listened to it); 'score' is the CED-base score where one was used.

PART=freesound, one of NPARTS uploader shards (sha256 of the uploader name), from run9-select.py's id list:
  * keyword rows ('Usable now' and 'Thin' tags) as listed;
  * ced-confirm rows ('Usable after audio check' tags) kept only when CED-base agrees, with ced-select.py's rules
    (scripts/hf-eval/data/ced-confirm-rules.json @ 47cbeb6), train and held-out alike; at most 400 train rows per tag;
  * ced-mapped rows: the CED run's candidates.csv (tags in data/ced-tag-map.json, AudioSet class score >= 0.5), CC0 / CC BY
    only, at most 15 per uploader and 400 per tag, train side only; keyword held-out rows of a ced-mapped tag need the same
    score. (The CED run is runs/ced-freesound-38026076860-1 of <user>/dge-eval-runs.)
  Then, as stage-freesound.py did for run 7, and more:
  * train rows dropped when in FSD50K eval, the cached Freesound test (ids or its uploader rule), a reserved test family
    (short-clip / synth-clip ids and uploaders, the three reserved-uploader hash rules), the DJ-effect held-out clips or
    their uploaders, run 7's held-out ids or uploaders, or re-hosted by ESC-50 / UrbanSound8K / Nonspeech7k;
  * held-out rows dropped when any training source holds the sound or its uploader: FSD50K dev, the cached Freesound
    training sounds and uploaders, run 7's fsnew training sounds and uploaders, this list's own train uploaders, and the
    ESC-50 / UrbanSound8K / Nonspeech7k re-hosts.
  No uploader ends up on both sides for any tag (checked). Open-vocab round-19 test ids are NOT removed (not available).
PART=labelled: ESC-50, Nonspeech7k, VIVAE, VocalSet, IRMAS (train set), Groove MIDI, Four-Way Tabla, Dagstuhl ChoirSet,
  VSCO 2 CE and the licensed-pilot CC0 packs (Karoryfer bass, Kenney, rubberduck), each mapped to the run 9 tags it labels
  (MAPS below) and split by its own performer / recording / source grouping (SPLITS below).
"""
import csv, glob, hashlib, io, json, os, re, shutil, subprocess, sys, tarfile, tempfile, time, urllib.parse, urllib.request, zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

UA = {'User-Agent': 'Mozilla/5.0 (DGE research; non-commercial tagger training)'}
GH = 'https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer'
CED_SHA = '47cbeb6fdc72d60cbcfa7efd5a1513a2e5ad1d6b'
CED_RUN = 'runs/ced-freesound-38026076860-1'
LIC = {0: 'CC0', 1: 'BY4', 2: 'BY3', 3: 'NC3', 4: 'NC4'}
OPEN = {'CC0', 'BY4', 'BY3'}
h8 = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
def reserved_rule(u):
    return h8('synth-fresh-up|freesound-user:' + u) % 5 == 0 or h8('dj-effects|' + u) % 4 == 0 or h8('dge-audio-model-freesound-test|' + u) % 10 == 0

def fetch(url, headers=None, tries=6, timeout=120):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=timeout) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410): return None
            time.sleep((20 if e.code == 429 else 3) * (i + 1))
        except Exception: time.sleep(3 * (i + 1))
    return None

class HttpFile(io.RawIOBase):
    """Seekable HTTP file (range requests), so zipfile can read single members of a large remote archive."""
    def __init__(self, url, block=4 << 20):
        self.url, self.pos, self.block, self.cache = url, 0, block, {}
        for i in range(8):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers=UA), timeout=60) as r: self.size = int(r.headers['Content-Length']); break
            except Exception:
                if i == 7: raise
                time.sleep(5 * (i + 1))
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off; return self.pos
    def _get(self, a, b):
        d = fetch(self.url, {'Range': f'bytes={a}-{b - 1}'}, tries=10)
        if d is None or len(d) != b - a: raise IOError(f'range read failed {self.url} {a}-{b}')
        return d
    def read(self, n=-1):
        n = self.size - self.pos if n < 0 else min(n, self.size - self.pos)
        if n <= 0: return b''
        if n > self.block: d = self._get(self.pos, self.pos + n)
        else:
            k = self.pos // self.block
            if k not in self.cache:
                if len(self.cache) > 16: self.cache.clear()
                self.cache[k] = self._get(k * self.block, min(self.size, (k + 1) * self.block))
            off = self.pos - k * self.block; d = self.cache[k][off:off + n]
            if len(d) < n: self.pos += len(d); return d + self.read(n - len(d))
        self.pos += len(d); return d
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

def to_flac(data, start=0.0, secs=10.0):
    """Any audio bytes -> mono 32 kHz FLAC of [start, start+secs), or None if silent or undecodable."""
    try:
        out = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-ss', str(start), '-t', str(secs), '-i', 'pipe:0', '-ac', '1', '-ar', '32000',
                              '-c:a', 'flac', '-f', 'flac', 'pipe:1'], input=data, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError: return None
    return out if len(out) > 2000 else None

def duration(data):
    try:
        p = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', '-i', 'pipe:0'], input=data, capture_output=True, check=True)
        return float(p.stdout.decode().strip() or 0)
    except Exception: return 0.0

class Out:
    """manifest.csv + tar shards of audio, uploaded as one folder."""
    COLS = ['id', 'source', 'group', 'split', 'tags', 'licence', 'reviewed', 'score', 'route', 'url']
    def __init__(self, name):
        self.dir = tempfile.mkdtemp(); self.name = name; self.rows = []; self.shard = None; self.n = 0; self.k = 0
    def add(self, row, data, ext):
        if self.shard is None or self.n >= 2000:
            if self.shard: self.shard.close()
            self.shard = tarfile.open(os.path.join(self.dir, f'audio-{self.k:03d}.tar'), 'w'); self.k += 1; self.n = 0
        ti = tarfile.TarInfo(f"{row['id'].replace(':', '_').replace('/', '_')}.{ext}"); ti.size = len(data); ti.mtime = 0
        self.shard.addfile(ti, io.BytesIO(data)); self.n += 1
        self.rows.append({**{c: '' for c in self.COLS}, 'reviewed': '0', **row, 'file': f'audio-{self.k - 1:03d}.tar/{ti.name}'})
    def close(self, summary):
        if self.shard: self.shard.close()
        with open(os.path.join(self.dir, 'manifest.csv'), 'w', newline='') as f:
            w = csv.DictWriter(f, self.COLS + ['file']); w.writeheader(); w.writerows(self.rows)
        pos = Counter((t, r['split']) for r in self.rows for t in r['tags'].split('|') if t)
        summary['tags'] = {t: {'train': pos[t, 'train'], 'heldout': pos[t, 'heldout']} for t in sorted({t for t, _ in pos})}
        summary['items'] = Counter(r['split'] for r in self.rows)
        summary['groups'] = {sp: len({(r['source'], r['group']) for r in self.rows if r['split'] == sp}) for sp in ('train', 'heldout')}
        json.dump(summary, open(os.path.join(self.dir, 'summary.json'), 'w'), indent=1)
        print('staged (train/heldout): ' + ', '.join(f"{t} {v['train']}/{v['heldout']}" for t, v in summary['tags'].items()), flush=True)
        return self.dir

def upload(folder, path_in_repo, msg):
    if os.environ.get('LOCAL_OUT'):   # test run: keep the staged folder locally, upload nothing
        dst = os.path.join(os.environ['LOCAL_OUT'], path_in_repo); shutil.copytree(folder, dst, dirs_exist_ok=True); print(f'kept {dst}'); return
    from huggingface_hub import HfApi
    api = HfApi(); repo = os.environ['STAGE_REPO']
    if not api.repo_info(repo, repo_type='dataset').private: sys.exit('staging repo is not private; refusing to upload')
    api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=folder, path_in_repo=path_in_repo, commit_message=msg)
    print(f'uploaded {path_in_repo}', flush=True)

# ---------------------------------------------------------------- Freesound
def b36dec(s):
    p, out = 0, []
    for x in s.split(','):
        if x: p += int(x, 36); out.append(p)
    return out

def exclusion_sets(sha):
    """Every judge / reserved / re-host id and uploader set the Freesound part checks against."""
    from huggingface_hub import hf_hub_download, HfApi
    me = HfApi().whoami()['name']; ex = {'bad_ids': set(), 'bad_users': set()}
    for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
        d = json.loads(fetch(f'{GH}/{sha}/{f}'))
        ex['bad_ids'] |= {int(x) for x in d.get('freesoundIds', [])}
        ex['bad_users'] |= {u.removeprefix('freesound-user:').casefold() for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
    ex['dj_users'] = set()
    for f in ('docs/evaluations/dj-effects-2026-10-06/clips.json', 'docs/evaluations/dj-effects-2026-10-09/clips.json'):
        for c in json.loads(fetch(f'{GH}/{sha}/{f}'))['clips']:
            if c.get('split') != 'train': ex['dj_users'].add(c['username'].casefold()); ex['bad_ids'].add(int(c['freesoundId']))
    fsd = lambda f: {int(r['fname']) for r in csv.DictReader(open(hf_hub_download('Fhrozen/FSD50k', f'labels/{f}.csv', repo_type='dataset')))}
    ex['fsd_eval'], ex['fsd_dev'] = fsd('eval'), fsd('dev')
    cache = lambda f: json.load(open(hf_hub_download(f'{me}/dge-tagger-data', f, repo_type='dataset')))['items']
    key = os.environ.get('CACHE_KEY', 'cb691f46e32e')
    fs_train_items = cache(f'prep-cache/{key}/fsprep/freesound.json')
    ex['fs_train'] = {int(i['id'].split(':')[1]) for i in fs_train_items}
    ex['fs_train_users'] = {i['artist'].removeprefix('freesound-user:').casefold() for i in fs_train_items if i.get('artist')}
    ex['fs_eval'] = {int(i['id'].split(':')[1]) for i in cache(f'prep-cache/{key}/fsprep/eval-freesound.json')}
    r7 = open(hf_hub_download(f'{me}/dge-private-train', 'freesound/staging-ids.tsv', repo_type='dataset')).read()
    ex['r7_train'], ex['r7_held'] = set(), set()
    for line in r7.splitlines():
        _, sp, ids = line.split('\t')
        (ex['r7_held'] if sp == 'heldout' else ex['r7_train']).update(int(x) for x in ids.split(','))
    man = json.load(open(hf_hub_download(f'{me}/dge-instrument-tagger', 'all-tags-run7/data-manifest.json')))
    ex['r7_held'] |= {int(i.split(':')[1]) for i in man.get('heldOutTest', {}).get('eval-fsnew', {}).get('ids', [])}
    ex['r7_train'] |= {int(i.split(':')[1]) for i in man['sources'].get('fsnew', {}).get('ids', []) if i.startswith('fsnew:')}
    subprocess.run([sys.executable, '-I', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'run9-exclusions.py'), 'rehost.json'], check=True)
    ex['rehost'] = {int(i) for v in json.load(open('rehost.json')).values() for i in v}
    print('exclusion sets: ' + ', '.join(f'{k} {len(v)}' for k, v in ex.items()), flush=True)
    return ex

def ced_scores(want):
    """CED-base probabilities for the wanted ids (dict id -> float32[527]) from the private CED run, plus candidates.csv."""
    import numpy as np
    from huggingface_hub import snapshot_download, HfApi
    me = HfApi().whoami()['name']
    d = snapshot_download(f'{me}/dge-eval-runs', repo_type='dataset', allow_patterns=[f'{CED_RUN}/*'], local_dir='ced', max_workers=16)
    run = os.path.join(d, CED_RUN); P, L = {}, {}
    for f in sorted(glob.glob(os.path.join(run, 'part-*', '*.npz'))):
        z = np.load(f, allow_pickle=False); ids = z['freesound_id'].astype(np.int64)
        hit = np.where(np.isin(ids, list(want)))[0]
        if not len(hit): continue
        probs, lic = z['probs'], z['license']
        for j in hit: P[int(ids[j])] = probs[j].astype(np.float32); L[int(ids[j])] = LIC.get(int(lic[j]), '?')
    return P, L, list(csv.DictReader(open(os.path.join(run, 'candidates.csv'))))

def stage_freesound(sha, nparts, partno):
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    data = open(hf_hub_download(os.environ['STAGE_REPO'], os.environ['IDS'], repo_type='dataset'), 'rb').read()
    if hashlib.md5(data).hexdigest() != os.environ['IDS_MD5']: sys.exit('id list md5 does not match IDS_MD5; refusing')
    listed = []   # (tag, split, route, id)
    for line in data.decode().splitlines():
        t, sp, rt, ids = line.split('\t'); listed += [(t, sp, rt, i) for i in b36dec(ids)]
    print(f'{len(listed)} listed rows, {len({x[3] for x in listed})} sounds', flush=True)
    rules = json.loads(fetch(f'{GH}/{CED_SHA}/scripts/hf-eval/data/ced-confirm-rules.json'))
    tagmap = json.loads(fetch(f'{GH}/{CED_SHA}/scripts/hf-eval/data/ced-tag-map.json'))['tags']
    meta = pq.read_table(hf_hub_download('Chr0my/freesound.org', 'freesound_parquet.parquet', repo_type='dataset'), columns=['id', 'username']).to_pydict()
    user = {int(i): u for i, u in zip(meta['id'], meta['username'])}
    ex = exclusion_sets(sha)
    P, L, cands = ced_scores({x[3] for x in listed})
    why = Counter(); rows = []   # (tag, split, id, username, licence, score, route)
    for t, sp, rt, i in listed:
        u = user.get(i)
        if u is None: why['no metadata (deleted sound)'] += 1; continue
        s = ''
        if rt in ('ced-confirm', 'ced-mapped'):
            p = P.get(i)
            if p is None: why[f'{rt}: no CED score'] += 1; continue
            if rt == 'ced-mapped': s = float(p[tagmap[t]].max()); ok = s >= 0.5
            elif t in rules['confirm']: s = float(p[rules['confirm'][t]].max()); ok = s >= rules['confirm_min']
            else: s = 1.0 - float(p[rules['reject_classes']].max()); ok = s > 1.0 - rules['reject_max']
            if not ok: why[f'{rt}: CED disagrees ({sp})'] += 1; continue
            s = round(s, 3)
        rows.append((t, sp, i, u, L.get(i, ''), s, rt))
    lic_of = {}
    for r in cands:   # the CED mapped list: train side only, CC0 / CC BY, uploader must not be a held-out uploader
        if float(r['score']) < 0.5: continue
        i, u, lic = int(r['freesound_id']), r['username'], LIC[int(r['license'])]
        if lic not in OPEN: why['ced-mapped: licence not CC0/BY'] += 1; continue
        if reserved_rule(u): why['ced-mapped: reserved uploader'] += 1; continue
        rows.append((r['tag'], 'train', i, u, lic, round(float(r['score']), 3), 'ced-mapped')); lic_of[i] = lic
    # held-out uploaders are fixed by the list (reserved-rule uploaders); train uploaders are everyone else
    train_users = {u.casefold() for t, sp, i, u, *_ in rows if sp == 'train'}
    r7_train_users = {user[i].casefold() for i in ex['r7_train'] if i in user}
    r7_held_users = {user[i].casefold() for i in ex['r7_held'] if i in user}
    keep, per_user, per_tag, seen = [], defaultdict(Counter), Counter(), set()
    for t, sp, i, u, lic, s, rt in sorted(rows, key=lambda r: (r[0], r[1], -(r[5] or 0), r[2])):
        uc = u.casefold(); r = None
        if (t, i) in seen: r = 'duplicate'
        elif i in ex['rehost']: r = 're-hosted by ESC-50 / US8K / Nonspeech7k'
        elif sp == 'train':
            r = ('FSD50K eval' if i in ex['fsd_eval'] else 'reserved test id' if i in ex['bad_ids'] else 'reserved family uploader' if uc in ex['bad_users']
                 else 'reserved uploader rule' if reserved_rule(u) else 'cached Freesound test' if i in ex['fs_eval'] else 'DJ-effect held-out uploader' if uc in ex['dj_users']
                 else 'run 7 held-out id or uploader' if i in ex['r7_held'] or uc in r7_held_users else 'already in run 7 training' if i in ex['r7_train']
                 else 'already in the cached Freesound source' if i in ex['fs_train'] else None)
            if not r and rt == 'ced-mapped':
                if per_user[t][uc] >= 15: r = 'ced-mapped uploader cap'
                elif per_tag[t, rt, sp] >= 400: r = 'ced-mapped tag cap'
            if not r and rt == 'ced-confirm' and per_tag[t, rt, sp] >= 400: r = 'ced-confirm tag cap'
        else:
            r = ('already trained (FSD50K dev)' if i in ex['fsd_dev'] else 'already trained (cached Freesound)' if i in ex['fs_train']
                 else 'already trained (run 7 fsnew)' if i in ex['r7_train'] else 'uploader trains elsewhere' if uc in ex['fs_train_users'] or uc in r7_train_users or uc in train_users
                 else 'reserved test id' if i in ex['bad_ids'] else None)
        seen.add((t, i))
        if r: why[f'{sp}: {r}'] += 1; continue
        if sp == 'train': per_user[t][uc] += 1
        per_tag[t, rt, sp] += 1
        keep.append((t, sp, i, u, lic, s, rt))
    sides = defaultdict(set); usides = defaultdict(set)
    for t, sp, i, u, *_ in keep: sides[i].add(sp); usides[u.casefold()].add(sp)
    bad = {i for i, v in sides.items() if len(v) > 1} | {i for t, sp, i, u, *_ in keep if len(usides[u.casefold()]) > 1}
    if bad: why['dropped: sound or uploader on both sides'] += len(bad); keep = [k for k in keep if k[2] not in bad]
    print('removed: ' + ', '.join(f'{k} {v}' for k, v in sorted(why.items())), flush=True)
    full = Counter((t, sp) for t, sp, *_ in keep)
    # this job's shard of uploaders
    mine = [k for k in keep if h8('run9-part|' + k[3]) % nparts == partno]
    sounds = defaultdict(lambda: {'tags': set()})
    for t, sp, i, u, lic, s, rt in mine:
        d = sounds[i]; d['tags'].add(t); d.update(split=sp, user=u, route=rt); d['lic'] = d.get('lic') or lic
        d['score'] = max(d.get('score') or 0, s or 0)
    print(f'part {partno}/{nparts}: {len(sounds)} sounds from {len({d["user"] for d in sounds.values()})} uploaders', flush=True)
    uids = {}
    def uid(item):
        u, s = item; page = fetch(f'https://freesound.org/people/{urllib.parse.quote(u)}/sounds/{s}/', timeout=60)
        m = page and re.search(rb'cdn\.freesound\.org/previews/\d+/\d+_(\d+)-hq\.mp3', page)
        return u, m and m.group(1).decode()
    first = {}
    for i, d in sounds.items(): first.setdefault(d['user'], i)
    t0 = time.time()
    with ThreadPoolExecutor(6) as pool:
        for k, (u, v) in enumerate(pool.map(uid, first.items())):
            uids[u] = v
            if k % 1000 == 0: print(f'  uploader ids {k}/{len(first)} {time.time() - t0:.0f} s', flush=True)
    print(f'{sum(v is not None for v in uids.values())} of {len(uids)} uploader ids found', flush=True)
    def audio(i):
        u = uids.get(sounds[i]['user'])
        b = u and fetch(f'https://cdn.freesound.org/previews/{i // 1000}/{i}_{u}-hq.mp3')
        return i, b if b and len(b) >= 4000 else None
    out = Out(f'freesound-{partno}'); got = 0
    with ThreadPoolExecutor(8) as pool:
        for k, (i, b) in enumerate(pool.map(audio, sorted(sounds))):
            if k % 5000 == 0: print(f'  previews {k}/{len(sounds)} {time.time() - t0:.0f} s', flush=True)
            if not b: continue
            d = sounds[i]; got += 1
            out.add({'id': f'freesound:{i}', 'source': 'freesound', 'group': f"freesound-user:{d['user']}", 'split': d['split'], 'tags': '|'.join(sorted(d['tags'])),
                     'licence': d['lic'] or 'unknown', 'score': d['score'] or '', 'url': f"https://freesound.org/people/{d['user']}/sounds/{i}/",
                     'route': d['route']}, b, 'mp3')
    summary = {'part': partno, 'nparts': nparts, 'removed': dict(why), 'listedRows': len(listed), 'keptRowsAllParts': {f'{t}|{sp}': n for (t, sp), n in sorted(full.items())},
               'sounds': len(sounds), 'staged': got, 'note': 'unreviewed: keyword and CED-base labels, nobody has listened; open-vocab r19 ids not removed'}
    folder = out.close(summary)
    upload(folder, f"{os.environ['OUT']}/freesound-{partno}", f'Stage run 9 Freesound part {partno}: {got} sounds')

# ---------------------------------------------------------------- labelled sets
ESC = {'dog': ['animal sound'], 'rooster': ['animal sound', 'bird ambience'], 'pig': ['animal sound'], 'cow': ['animal sound'], 'frog': ['animal sound'],
       'cat': ['animal sound'], 'hen': ['animal sound', 'bird ambience'], 'insects': ['animal sound', 'environmental sound'], 'sheep': ['animal sound'],
       'crow': ['animal sound', 'bird ambience'], 'rain': ['rain ambience', 'environmental sound'], 'sea_waves': ['water ambience', 'environmental sound'],
       'crackling_fire': ['environmental sound'], 'crickets': ['animal sound', 'environmental sound'], 'chirping_birds': ['bird ambience', 'animal sound', 'environmental sound'],
       'water_drops': ['water ambience'], 'wind': ['wind ambience', 'environmental sound'], 'pouring_water': ['water ambience', 'foley'],
       'thunderstorm': ['rain ambience', 'environmental sound'], 'clapping': ['clap'], 'breathing': ['breath', 'vocal breath'], 'footsteps': ['foley'],
       'brushing_teeth': ['foley'], 'drinking_sipping': ['foley'], 'door_wood_knock': ['foley', 'foley hit'], 'mouse_click': ['foley'], 'keyboard_typing': ['foley'],
       'door_wood_creaks': ['foley'], 'can_opening': ['foley'], 'washing_machine': ['machine ambience'], 'vacuum_cleaner': ['machine ambience'],
       'clock_tick': ['foley'], 'glass_breaking': ['foley'], 'helicopter': ['machine ambience'], 'chainsaw': ['machine ambience'], 'engine': ['machine ambience'],
       'train': ['machine ambience'], 'church_bells': ['bell'], 'airplane': ['machine ambience'], 'hand_saw': ['foley'], 'toilet_flush': ['water ambience', 'foley']}
VSCO = [('Brass/F Horn', ['horn']), ('Brass/OldTrombone', ['trombone']), ('Brass/Tenor Trombone', ['trombone']), ('Brass/Trumpet', ['trumpet']), ('Brass/Tuba', ['tuba']),
        ('Strings/Cello Section', ['cello']), ('Strings/Solo Contrabass', ['double bass']), ('Strings/Viola Section', ['viola']),
        ('Woodwinds/Bassoon', ['bassoon']), ('Woodwinds/Clarinet', ['clarinet']), ('Woodwinds/Flute', ['flute']), ('Woodwinds/Piccolo', ['flute']), ('Woodwinds/Oboe', ['oboe']),
        ('Percussion/Glock', ['glockenspiel', 'tuned percussion', 'percussion']), ('Percussion/Marimba', ['marimba', 'tuned percussion', 'percussion']),
        ('Percussion/Xylo', ['xylophone', 'tuned percussion', 'percussion']), ('Percussion/vibraring', ['percussion']),
        ('Percussion/Claves', ['clave', 'percussion']), ('Percussion/Conga', ['conga', 'hand percussion', 'percussion']), ('Percussion/Quinto', ['conga', 'hand percussion', 'percussion']),
        ('Percussion/Tumba', ['conga', 'hand percussion', 'percussion']), ('Percussion/Tamb', ['tambourine', 'percussion']), ('Percussion/Triangle', ['triangle', 'percussion']),
        ('Percussion/gong', ['gong', 'percussion']), ('Percussion/susCymb', ['cymbal', 'percussion']), ('Percussion/cymbal', ['cymbal', 'percussion']),
        ('Percussion/Snare', ['snare', 'percussion']), ('Percussion/LogDrum', ['hand percussion', 'percussion']), ('Percussion/zap', []), ('Percussion/alien', []),
        ('Percussion/', ['percussion'])]
IRMAS = {'cel': ['cello'], 'cla': ['clarinet'], 'flu': ['flute'], 'tru': ['trumpet'], 'voi': ['voice']}   # other folders: weak negatives only
VOCALSET_HELD = {'female2', 'female8', 'male3', 'male9'}
VIVAE_HELD = {'S10', 'S11'}
GMD_HELD = {'drummer7'}
CHOIR_HELD = 'TP'

LIMIT = int(os.environ.get('LIMIT', '0'))   # test runs: at most LIMIT items per source, archives read by range

def zip_from(url, cache=None):
    if cache and not LIMIT:
        if not os.path.exists(cache):
            subprocess.run(['curl', '-fsSL', '--retry', '8', '-o', cache, url], check=True)
        return zipfile.ZipFile(cache)
    return zipfile.ZipFile(HttpFile(url))

def windows(data, n, secs=10.0):
    d = duration(data); starts = [0.0] if d <= secs + 1 else [k * secs for k in range(min(n, int(d // secs)))]
    return [(s, to_flac(data, s, secs)) for s in starts]

def stage_labelled(sha):
    if os.environ.get('NO_EXCL'): judge_fs = set()   # local test runs only (no token for the private sets)
    else:
        ex = exclusion_sets(sha)   # Freesound-sourced sets (ESC-50, Nonspeech7k) must avoid judge ids too
        judge_fs = ex['bad_ids'] | ex['fsd_eval'] | ex['fs_eval'] | ex['r7_held']
    out = Out('labelled'); why = Counter(); stats = Counter(); seen = Counter()
    def add(src, gid, split, tags, lic, url, data, start=0.0, n=1, ident=None):
        if LIMIT and seen[src] >= LIMIT: return
        seen[src] += 1
        if callable(data): data = data()   # archive members are read only when used
        for s, fl in windows(data, n) if n > 1 else [(start, to_flac(data, start))]:
            if not fl: why[f'{src}: silent or undecodable'] += 1; continue
            out.add({'id': f'{src}:{ident or gid}@{int(s)}', 'source': src, 'group': f'{src}:{gid}', 'split': split, 'tags': '|'.join(tags), 'licence': lic, 'url': url}, fl, 'flac')
            stats[src, split] += 1
    # ESC-50 (CC BY-NC 3.0): fold 5 held out (ESC-50 keeps clips of one source recording in one fold)
    def src_esc50():
        z = zip_from('https://github.com/karolpiczak/ESC-50/archive/refs/heads/master.zip', 'esc50.zip')
        meta = list(csv.DictReader(io.TextIOWrapper(z.open('ESC-50-master/meta/esc50.csv'))))
        for r in meta:
            tags = ESC.get(r['category'])
            if not tags: continue
            if int(r['src_file']) in judge_fs: why['esc50: Freesound id in a judge set'] += 1; continue
            add('esc50', r['src_file'], 'heldout' if r['fold'] == '5' else 'train', tags, 'CC BY-NC 3.0', 'https://github.com/karolpiczak/ESC-50',
                lambda r=r: z.read(f"ESC-50-master/audio/{r['filename']}"), ident=r['filename'].removesuffix('.wav'))
    # Nonspeech7k (CC BY-NC-SA 4.0): its own test split held out; a source recording with any test segment is held out whole
    def src_nonspeech7k():
        import pyarrow.parquet as pq
        from huggingface_hub import hf_hub_download
        NS = {'breath': ['breath', 'vocal breath'], 'scream': ['vocal scream', 'voice']}
        nsrows = []
        for sp in ('train', 'test'):
            t = pq.read_table(hf_hub_download('W4ng1204/Nonspeech7k', f'{sp}.parquet', repo_type='dataset'), columns=['audio', 'filename', 'classname', 'source'])
            for a, f, c, s in zip(t.column('audio').to_pylist(), t.column('filename').to_pylist(), t.column('classname').to_pylist(), t.column('source').to_pylist()):
                if c in NS: nsrows.append((sp, f, c, s or '', a['bytes']))
        grp = lambda f: re.split(r'[-_]', f)[0]
        test_groups = {grp(f) for sp, f, *_ in nsrows if sp == 'test'}
        for sp, f, c, s, b in nsrows:
            g = grp(f)
            if 'freesound' in s and g.isdigit() and int(g) in judge_fs: why['nonspeech7k: Freesound id in a judge set'] += 1; continue
            add('nonspeech7k', g, 'heldout' if g in test_groups else 'train', NS[c], 'CC BY-NC-SA 4.0', 'https://zenodo.org/records/6967442', b, ident=f.removesuffix('.wav'))
    # VIVAE (CC BY-NC 4.0): speakers S10, S11 held out; strong/peak fear and pain = screams, strong/peak anger = shouts
    def src_vivae():
        z = zip_from('https://zenodo.org/records/4066235/files/VIVAE.zip', 'vivae.zip')
        for n in z.namelist():
            m = re.match(r'VIVAE/full_set/(S\d+)_(\w+?)_(\w+?)_\d+\.wav$', n)
            if not m: continue
            spk, emo, inten = m.groups(); tags = None
            if inten in ('strong', 'peak') and emo in ('fear', 'pain'): tags = ['vocal scream', 'voice']
            elif inten in ('strong', 'peak') and emo == 'anger': tags = ['vocal shout', 'voice']
            if not tags: continue
            add('vivae', spk, 'heldout' if spk in VIVAE_HELD else 'train', tags, 'CC BY-NC 4.0', 'https://zenodo.org/records/4066235', lambda n=n: z.read(n), ident=os.path.basename(n)[:-4])
    # VocalSet (CC BY 4.0): four singers held out
    def src_vocalset():
        z = zip_from('https://zenodo.org/records/1193957/files/VocalSet.zip', 'vocalset.zip')
        for n in z.namelist():
            m = re.match(r'FULL/((?:fe)?male\d+)/(\w+)/(\w+)/.*\.wav$', n)
            if not m or '__MACOSX' in n: continue
            singer, cat, tech = m.groups()
            if tech == 'spoken': tags = ['spoken phrase', 'voice']
            elif cat == 'excerpts': tags = ['vocal phrase', 'voice']
            elif cat in ('long_tones', 'scales', 'arpeggios') and tech in ('straight', 'vibrato', 'forte', 'pp', 'messa', 'belt', 'breathy', 'slow_forte', 'slow_piano'): tags = ['vocal vowel', 'voice']
            else: tags = ['voice']
            add('vocalset', singer, 'heldout' if singer in VOCALSET_HELD else 'train', tags, 'CC BY 4.0', 'https://zenodo.org/records/1193957', lambda n=n: z.read(n), n=2, ident=os.path.basename(n)[:-4])
    # IRMAS training set (CC BY-NC-SA 4.0): one in five source excerpts held out (hash of the excerpt name)
    def src_irmas():
        z = zip_from('https://zenodo.org/records/1290750/files/IRMAS-TrainingData.zip', 'irmas.zip')
        for n in z.namelist():
            m = re.match(r'IRMAS-TrainingData/(\w+)/(.+?)(?:__\d+)?\.wav$', n)
            if not m: continue
            inst, g = m.groups(); tags = IRMAS.get(inst, [])
            if not tags and h8('run9-irmas-neg|' + n) % 4: continue   # a quarter of the other folders as (weak) negatives
            add('irmas', g, 'heldout' if h8('run9-irmas|' + g) % 5 == 0 else 'train', tags, 'CC BY-NC-SA 4.0', 'https://zenodo.org/records/1290750', lambda n=n: z.read(n), ident=os.path.basename(n)[:-4])
    # Groove MIDI (CC BY 4.0): drummer7 held out; beats are drum loops (up to 3 windows), fills are drum fills
    def src_gmd():
        z = zip_from('https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0.zip', 'gmd.zip')
        for r in csv.DictReader(io.TextIOWrapper(z.open('groove/info.csv'))):
            if not r['audio_filename']: continue
            tags = ['drum fill'] if r['beat_type'] == 'fill' else ['drum loop']
            add('gmd', r['drummer'], 'heldout' if r['drummer'] in GMD_HELD else 'train', tags, 'CC BY 4.0', 'https://magenta.tensorflow.org/datasets/groove',
                lambda r=r: z.read('groove/' + r['audio_filename']), n=1 if r['beat_type'] == 'fill' else 3, ident=r['id'].replace('/', '-'))
    # Four-Way Tabla (CC BY 4.0): the dataset's test folder (other compositions and performers) held out
    def src_tabla():
        z = zip_from('https://zenodo.org/records/7110248/files/4way-tabla-ismir21-dataset.zip', 'tabla.zip')
        for n in z.namelist():
            m = re.match(r'4way-tabla-ismir21-dataset/(train|test)/audios/(.+)\.wav$', n)
            if not m: continue
            sp, name = m.groups(); g = re.split(r'[_-]', name)[0] if sp == 'train' else name
            add('tabla', g, 'heldout' if sp == 'test' else 'train', ['tabla', 'hand percussion', 'percussion'], 'CC BY 4.0', 'https://zenodo.org/records/7110248', lambda n=n: z.read(n), n=3, ident=name)
    # Dagstuhl ChoirSet (CC BY 4.0): stereo room mic only; piece TP held out (same singers sing every piece: no singer-disjoint split exists)
    def src_choirset():
        z = zip_from('https://zenodo.org/records/4618287/files/DagstuhlChoirSet_V1.2.3.zip', 'choirset.zip')
        for n in z.namelist():
            m = re.match(r'.*/(DCS_(\w\w)_(FullChoir|QuartetA|QuartetB|Basses)_[A-Za-z]+\d+)_Stereo_STM\.wav$', n)
            if not m: continue
            take, piece, ens = m.groups()
            tags = {'FullChoir': ['choir', 'vocal harmony', 'voice'], 'Basses': ['choir', 'voice'], 'QuartetA': ['vocal harmony', 'voice'], 'QuartetB': ['vocal harmony', 'voice']}[ens]
            add('choirset', piece, 'heldout' if piece == CHOIR_HELD else 'train', tags, 'CC BY 4.0', 'https://zenodo.org/records/4618287', lambda n=n: z.read(n), n=8, ident=take)
    # VSCO 2 CE (CC0): one sample library, so it trains only (its tags are tested on other sets)
    def src_vsco2():
        subprocess.run(['git', 'clone', '-q', '--depth', '1', 'https://github.com/sgossner/VSCO-2-CE.git', 'vsco'], check=True)
        for p in sorted(glob.glob('vsco/**/*.wav', recursive=True)):
            rel = os.path.relpath(p, 'vsco'); tags = next((v for k, v in VSCO if rel.startswith(k)), None)
            if not tags: continue
            add('vsco2', rel.split('/')[1] if '/' in rel else rel, 'train', tags, 'CC0', 'https://github.com/sgossner/VSCO-2-CE', open(p, 'rb').read(), ident=rel.replace('/', '-').replace(' ', '_')[:-4])
    # Licensed-pilot CC0 packs (sources-2026-10-10.json of the licensed-audio pilot): train only (one session or pack each)
    def src_pilot():
        subprocess.run(['git', 'clone', '-q', 'https://github.com/sfzinstruments/karoryfer.big-little-bass.git', 'karoryfer'], check=True)
        subprocess.run(['git', '-C', 'karoryfer', 'checkout', '-q', '4e92bdf54dcd2d6cfad968cc90542d5461c9b9fc'], check=True)
        for p in sorted(glob.glob('karoryfer/Samples/big_little_pluck_*.wav')):
            note = re.match(r'big_little_pluck_([a-g]b?\d)', os.path.basename(p)).group(1)
            add('karoryfer', note, 'train', ['bass guitar'], 'CC0', 'https://github.com/sfzinstruments/karoryfer.big-little-bass', open(p, 'rb').read(), ident=os.path.basename(p)[:-4])
        for url, sha, pat, tags in (
                ('https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip', '029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8', r'impact\w+', ['foley hit']),
                ('https://opengameart.org/sites/default/files/sci-fi_sounds.zip', '119340f351a5098ad814f78719438c0da355a9ce8a4c8a3af6a8d48aa3d49e04', r'laser\w+', ['laser']),
                ('https://opengameart.org/sites/default/files/sfx_100_v2.zip', '0fc61b4494e2e893c0c015ced4877b3f689c7d84a48cb61daecd7ddb52db797b', r'sfx100v2_(?:\w+_)?hit\w*', ['foley hit']),
                ('https://opengameart.org/sites/default/files/50-CC0-retro-synth-SFX.zip', 'db9370bfbe228d1fc3912ec455ad358129eeec593169fc02701ff48d888db9cb', r'synth_laser\w*', ['laser'])):
            b = fetch(url)
            if not b or hashlib.sha256(b).hexdigest() != sha: why[f'pilot: {url} missing or checksum changed'] += 1; continue
            z = zipfile.ZipFile(io.BytesIO(b))
            for n in z.namelist():
                base = os.path.basename(n); m = re.fullmatch(pat + r'\.(ogg|wav|mp3)', base)
                if not m: continue
                add('pilot-' + url.split('/')[-1].split('.')[0], re.sub(r'_?\d+$', '', base.rsplit('.', 1)[0]), 'train', tags, 'CC0', url, lambda n=n: z.read(n), ident=base.rsplit('.', 1)[0])
    skip = set(os.environ.get('SKIP', '').split(','))
    for name, fn in {'esc50': src_esc50, 'nonspeech7k': src_nonspeech7k, 'vivae': src_vivae, 'vocalset': src_vocalset, 'irmas': src_irmas, 'gmd': src_gmd, 'tabla': src_tabla, 'choirset': src_choirset, 'vsco2': src_vsco2, 'pilot': src_pilot}.items():
        if name in skip: why[f'{name}: skipped'] += 1; continue
        t0 = time.time()
        try: fn()
        except Exception as e:   # one unreachable source must not sink the others; the summary names it
            import traceback; traceback.print_exc(); why[f'{name}: FAILED {type(e).__name__}: {e}'[:300]] += 1
        for f in glob.glob('*.zip'): os.remove(f)   # free the disk before the next archive
        shutil.rmtree('vsco', ignore_errors=True); shutil.rmtree('karoryfer', ignore_errors=True)
        print(f'  {name}: {sum(v for (s, _), v in stats.items() if s == name or s.startswith(name))} windows, {time.time() - t0:.0f} s', flush=True)
    print('labelled windows: ' + ', '.join(f'{s} {sp} {n}' for (s, sp), n in sorted(stats.items())), flush=True)
    summary = {'removed': dict(why), 'windows': {f'{s}|{sp}': n for (s, sp), n in sorted(stats.items())},
               'note': 'unreviewed: labels come from each set\'s own metadata, nobody has listened'}
    folder = out.close(summary)
    upload(folder, f"{os.environ['OUT']}/labelled", f'Stage run 9 labelled sets: {len(out.rows)} windows')

if __name__ == '__main__':
    sha = os.environ['REPO_SHA']
    if os.environ.get('PART', 'freesound') == 'freesound': stage_freesound(sha, int(os.environ.get('NPARTS', '1')), int(os.environ.get('PARTNO', '0')))
    else: stage_labelled(sha)
