"""Stage the run 7 Freesound sounds (tags with no or too little training audio) into a PRIVATE Hugging Face dataset, after
removing every sound a judge set uses, so the tagger job (hf-job.sh FSNEW_DATA, prepare-fsnew.py) reads a fixed copy.

Runs as a small CPU Hugging Face job with a token that can read <user>/dge-tagger-data and write the staging dataset:
  STAGE_REPO=<user>/dge-private-train IDS=freesound/staging-ids.tsv IDS_MD5=<md5> OUT=freesound/fsnew-v1 REPO_SHA=<sha> \
  python3 stage-freesound.py

IDS (private; made from the no-source-tags candidate list, never committed) has lines 'tag<TAB>train|heldout<TAB>id,id,...':
train rows are CC0 or CC BY sounds only; heldout rows are test clips for tags with no test audio yet. Its md5 must equal IDS_MD5.
Removed before staging (each count is printed):
  * train rows in FSD50K eval, in the short-clip or synth-clip reserved test families (sound ids and uploaders, plus the
    synth-clip uploader rule), in the cached Freesound source's held-out test (ids and its held-out uploader rule), or
    whose uploader also has a heldout row here;
  * heldout rows that any training source already holds: FSD50K dev and the cached Freesound training sounds.
(The DJ-effect clips' non-train sounds were removed when the id list was made.)
Audio is each sound's public preview MP3 (first ~15 s). Writes OUT/audio/<id>.mp3 and OUT/manifest.csv
(id, username, split, tags) and refuses to upload unless the repo is private.
"""
import csv, hashlib, io, json, os, re, sys, tempfile, time, urllib.parse, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from huggingface_hub import HfApi, hf_hub_download

UA = {'User-Agent': 'Mozilla/5.0 (DGE research; non-commercial tagger training)'}
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
synth_held = lambda user: int(h('synth-fresh-up', f'freesound-user:{user}')[:8], 16) % 5 == 0   # as prepare-freesound.py
fs_test = lambda user: int(h('dge-audio-model-freesound-test', user)[:8], 16) % 10 == 0

def fetch(url, headers=None, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410): return None
            time.sleep((10 if e.code == 429 else 3) * (i + 1))
        except Exception: time.sleep(3 * (i + 1))
    return None

def main():
    repo, out, sha = os.environ['STAGE_REPO'], os.environ['OUT'], os.environ['REPO_SHA']
    api = HfApi(); me = api.whoami()['name']
    data = open(hf_hub_download(repo, os.environ['IDS'], repo_type='dataset'), 'rb').read()
    if hashlib.md5(data).hexdigest() != os.environ['IDS_MD5']: sys.exit('id list md5 does not match IDS_MD5; refusing')
    tags, split = {}, {}
    for line in data.decode().splitlines():
        t, sp, ids = line.split('\t')
        for s in ids.split(','):
            tags.setdefault(int(s), set()).add(t)
            if split.get(int(s), sp) != sp: sys.exit(f'sound in both splits: {s}')
            split[int(s)] = sp
    print(f'{len(split)} sounds listed ({sum(v == "train" for v in split.values())} train)', flush=True)

    import pyarrow.parquet as pq
    meta = pq.read_table(hf_hub_download('Chr0my/freesound.org', 'freesound_parquet.parquet', repo_type='dataset'), columns=['id', 'username']).to_pydict()
    user = {int(i): u for i, u in zip(meta['id'], meta['username']) if int(i) in split}
    fsd = lambda f: {int(r['fname']) for r in csv.DictReader(open(hf_hub_download('Fhrozen/FSD50k', f'labels/{f}.csv', repo_type='dataset')))}
    fsd_eval, fsd_dev = fsd('eval'), fsd('dev')
    bad_ids, bad_users = set(), set()
    for f in ('docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'):
        raw = fetch(f'https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer/{sha}/{f}')
        if raw is None: sys.exit(f'could not fetch {f} at {sha}; refusing to stage without the reserved test families')
        d = json.loads(raw)
        bad_ids |= {int(x) for x in d.get('freesoundIds', [])}
        bad_users |= {u.removeprefix('freesound-user:') for k in ('freesoundUploaders', 'fsdUploaders') for u in d.get(k, [])}
    cache = lambda f: json.load(open(hf_hub_download(f'{me}/dge-tagger-data', f, repo_type='dataset')))['items']
    key = os.environ.get('CACHE_KEY', 'cb691f46e32e')
    fs_train = {int(i['id'].split(':')[1]) for i in cache(f'prep-cache/{key}/fsprep/freesound.json')}
    fs_eval = {int(i['id'].split(':')[1]) for i in cache(f'prep-cache/{key}/fsprep/eval-freesound.json')}
    held_users = {user.get(s) for s, sp in split.items() if sp == 'heldout'} - {None}

    why = Counter(); keep = []
    for s, sp in sorted(split.items()):
        u = user.get(s)
        if u is None: why['no metadata (deleted sound)'] += 1; continue
        if sp == 'train':
            r = ('FSD50K eval' if s in fsd_eval else 'reserved test sound' if s in bad_ids else 'reserved test uploader' if u in bad_users or synth_held(u)
                 else 'cached Freesound test' if s in fs_eval or fs_test(u) else 'uploader has a heldout sound' if u in held_users else None)
        else:
            r = 'already trained (FSD50K dev)' if s in fsd_dev else 'already trained (cached Freesound)' if s in fs_train else None
        if r: why[f'{sp}: {r}'] += 1
        else: keep.append(s)
    print('removed: ' + (', '.join(f'{k} {v}' for k, v in sorted(why.items())) or 'none'), flush=True)

    users = {}
    for s in keep: users.setdefault(user[s], s)
    def uid(item):
        u, s = item; page = fetch(f'https://freesound.org/people/{urllib.parse.quote(u)}/sounds/{s}/')
        m = page and re.search(rb'cdn\.freesound\.org/previews/\d+/\d+_(\d+)-hq\.mp3', page)
        return u, m and m.group(1).decode()
    with ThreadPoolExecutor(4) as pool: uids = dict(pool.map(uid, users.items()))
    print(f'{sum(v is not None for v in uids.values())} of {len(uids)} uploader ids found', flush=True)
    tmp = tempfile.mkdtemp(); os.makedirs(os.path.join(tmp, 'audio'))
    def audio(s):
        u = uids.get(user[s])
        b = u and fetch(f'https://cdn.freesound.org/previews/{s // 1000}/{s}_{u}-hq.mp3')
        if not b or len(b) < 4000: return s, False
        open(os.path.join(tmp, 'audio', f'{s}.mp3'), 'wb').write(b); return s, True
    with ThreadPoolExecutor(8) as pool: got = [s for s, ok in pool.map(audio, keep) if ok]
    with open(os.path.join(tmp, 'manifest.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['id', 'username', 'split', 'tags'])
        for s in got: w.writerow([s, user[s], split[s], '|'.join(sorted(tags[s]))])
    pos = Counter((t, split[s]) for s in got for t in tags[s])
    print('staged positives (train/heldout): ' + ', '.join(f'{t} {pos[t, "train"]}/{pos[t, "heldout"]}' for t in sorted({t for t, _ in pos})), flush=True)
    if not api.repo_info(repo, repo_type='dataset').private: sys.exit('staging repo is not private; refusing to upload')
    api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=tmp, path_in_repo=out, commit_message=f'Stage run 7 Freesound sounds: {len(got)} files')
    print(f'staged {len(got)} of {len(keep)} sounds ({len(keep) - len(got)} previews unavailable)', flush=True)

if __name__ == '__main__':
    main()
