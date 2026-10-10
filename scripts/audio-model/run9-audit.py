"""Audit tagger run 9's staged audio and add the NC clips the staging skipped (runs as one small CPU HF job).

  STAGE_REPO=<user>/dge-private-train IN=run9/v1 OUT=run9/v1-audit RUN9_SHA=<run 9 prep commit> \
  TARGETS=<comma-separated tags below 60/60> python3 -I run9-audit.py

Reads every <IN>/<part>/manifest.csv and its audio tars (made by stage-run9.py on branch
claude/raise-tag-accuracy-6ifnkl-run9) and writes <OUT>/manifest-audited.csv with, for every item:
  url, creator, licence, licence_class (open: CC0 / CC BY; nc: CC BY-NC; other), encoded_sha256 (the staged file),
  pcm_sha256 (decoded to 32 kHz mono 16-bit, so re-encodes of one recording match), seconds, split, group,
  tags, label_evidence (why each tag was given), keep, drop_reason.
Identical decoded audio is one sound: when a copy is held out, every training copy is dropped; otherwise the first
copy is kept, the others are dropped and their tags merge into it.

NC supplement (Chris 2026-10-10: training may use any licence): the CED mapped list's CC BY-NC rows (score >= 0.5)
for the TARGETS tags, which stage-run9.py dropped for licence. They pass the same train-side exclusions as
stage-run9.py (imported from RUN9_SHA), the same caps (15 per uploader; a tag's CED mapped rows stay <= 400 in total),
and their uploader must not be held out anywhere in the staged manifests. Staged under <IN>/nc-supplement/ like
stage-run9.py does (Freesound preview MP3) and audited the same way. Weights trained on them stay CC BY-NC-SA.
Never uploads unless the repo is private. No held-out audio is read except the staged held-out rows themselves.

EXTRA_EXCL (optional): paths, comma-separated, to training-exclusions.json files made by other held-out test sets
({"freesound_ids": [...], "freesound_uploaders": [...], "audio_md5": [...]}; md5 of the 32 kHz mono s16le decode, whole
or first 10 s). Training items matching any of them are dropped.
"""
import csv, hashlib, importlib.util, io, json, os, re, subprocess, sys, tarfile, tempfile, urllib.parse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

from huggingface_hub import HfApi, hf_hub_download

REPO, IN, OUT = os.environ['STAGE_REPO'], os.environ['IN'].rstrip('/'), os.environ['OUT'].rstrip('/')
TARGETS = {t.strip() for t in os.environ.get('TARGETS', '').split(',') if t.strip()}
EXTRA = {'ids': set(), 'users': set(), 'md5': set()}
for _p in filter(None, os.environ.get('EXTRA_EXCL', '').split(',')):
    _x = json.load(open(_p))
    EXTRA['ids'] |= {int(i) for i in _x.get('freesound_ids', [])}
    EXTRA['users'] |= {u.casefold() for u in _x.get('freesound_uploaders', [])}
    EXTRA['md5'] |= set(_x.get('audio_md5', []))
api = HfApi()


def load_stage():
    """stage-run9.py from a checkout of the run 9 prep commit (RUN9_CHECKOUT at RUN9_SHA), imported as a module for its
    exclusion sets, fetch and Out helpers; it runs run9-exclusions.py from the same folder."""
    sha, co = os.environ['RUN9_SHA'], os.environ.get('RUN9_CHECKOUT', '/work/r9')
    head = subprocess.run(['git', '-C', co, 'rev-parse', 'HEAD'], capture_output=True, check=True, text=True).stdout.strip()
    if not head.startswith(sha): sys.exit(f'RUN9_CHECKOUT is at {head}, not {sha}')
    spec = importlib.util.spec_from_file_location('stage_run9', os.path.join(co, 'scripts', 'audio-model', 'stage-run9.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m, sha


def lic_class(lic):
    l = (lic or '').upper().replace('-', '').replace(' ', '')
    if 'NC' in l: return 'nc'
    if l in ('CC0', 'BY4', 'BY3') or 'CC0' in l or 'BY' in l: return 'open'
    return 'other'


def pcm_hash(data):
    """sha256 of the decoded audio (32 kHz mono s16le), its length in seconds, and whether that decode (whole or first
    10 s) has an EXTRA_EXCL md5; (None, 0, False) if undecodable. One decode per item keeps the job short."""
    try:
        pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '32000', '-f', 's16le', 'pipe:1'],
                             input=data, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError:
        return None, 0.0, False
    if not pcm: return None, 0.0, False
    hit = bool(EXTRA['md5']) and (hashlib.md5(pcm).hexdigest() in EXTRA['md5'] or hashlib.md5(pcm[:640000]).hexdigest() in EXTRA['md5'])
    return hashlib.sha256(pcm).hexdigest(), round(len(pcm) / 64000, 3), hit


def freesound_meta(ids):
    """title, tags and description per Freesound id, from the public metadata parquet stage-run9.py uses."""
    import pyarrow.parquet as pq
    f = hf_hub_download('Chr0my/freesound.org', 'freesound_parquet.parquet', repo_type='dataset')
    names = pq.read_schema(f).names
    cols = ['id'] + [c for c in ('name', 'title', 'tags', 'description') if c in names]
    t = pq.read_table(f, columns=cols).to_pydict(); out = {}
    for k, i in enumerate(t['id']):
        i = int(i)
        if i in ids: out[i] = {c: t[c][k] for c in cols[1:]}
    return out


def evidence(row, meta):
    """One line saying why each tag was given."""
    route, score, src = row.get('route', ''), row.get('score', ''), row.get('source', '')
    if src != 'freesound':
        return f'dataset label: {src} {row.get("group", "")}'.strip()
    i = int(row['id'].split(':')[1]); m = meta.get(i, {})
    words = ' '.join(str(m.get(c) or '') if not isinstance(m.get(c), list) else ' '.join(m[c]) for c in ('name', 'title', 'tags'))
    found = sorted({t for t in row['tags'].split('|') if t and re.search(r'\b' + re.escape(t.split()[0]), words, re.I)})
    parts = []
    if route in ('keyword', 'ced-confirm'): parts.append('uploader title/tags' + (f' mention {", ".join(found)}' if found else ' (keyword rule)'))
    if route in ('ced-confirm', 'ced-mapped', 'ced-mapped-nc') and score not in ('', None): parts.append(f'CED-base AudioSet score {score}')
    parts.append('not listened')
    return '; '.join(parts)


LOCAL = 'stage'   # every staged part is downloaded here at once, early: the job's HF token can expire within the hour


def read_part(folder):
    """(rows, {file member path: bytes}) for one staged folder, from LOCAL."""
    rows = list(csv.DictReader(open(os.path.join(LOCAL, folder, 'manifest.csv'))))
    blobs = {}
    for tar in sorted({r['file'].split('/')[0] for r in rows if r.get('file')}):
        with tarfile.open(os.path.join(LOCAL, folder, tar)) as tf:
            for mem in tf.getmembers():
                blobs[f'{tar}/{mem.name}'] = tf.extractfile(mem).read()
    return rows, blobs


def stage_nc(st, sha, staged_rows):
    """Stage the CED mapped list's NC rows for TARGETS tags (see module doc); returns the staged folder name or None."""
    import numpy as np
    from huggingface_hub import snapshot_download
    me = api.whoami()['name']
    d = snapshot_download(f'{me}/dge-eval-runs', repo_type='dataset', allow_patterns=[f'{st.CED_RUN}/candidates.csv'], local_dir='ced')
    cands = list(csv.DictReader(open(os.path.join(d, st.CED_RUN, 'candidates.csv'))))
    ex = st.exclusion_sets(sha)
    held_users = {r['group'].removeprefix('freesound-user:').casefold() for r in staged_rows if r['split'] == 'heldout' and r['source'] == 'freesound'}
    staged_ids = {r['id'] for r in staged_rows}
    mapped = Counter(); per_user = defaultdict(Counter)
    for r in staged_rows:
        if r.get('route') == 'ced-mapped' and r['split'] == 'train':
            u = r['group'].removeprefix('freesound-user:').casefold()
            for t in r['tags'].split('|'):
                mapped[t] += 1; per_user[t][u] += 1
    why, keep = Counter(), []
    for r in sorted(cands, key=lambda r: (r['tag'], -float(r['score']))):
        t, i, u, lic = r['tag'], int(r['freesound_id']), r['username'], st.LIC.get(int(r['license']), '?')
        if t not in TARGETS or float(r['score']) < 0.5 or lic not in ('NC3', 'NC4'): continue
        uc = u.casefold()
        reason = ('already staged' if f'freesound:{i}' in staged_ids else 'reserved uploader rule' if st.reserved_rule(u)
                  else 'held-out uploader in run 9' if uc in held_users else 'FSD50K eval' if i in ex['fsd_eval']
                  else 'other held-out test set' if i in EXTRA['ids'] or uc in EXTRA['users']
                  else 'reserved test id' if i in ex['bad_ids'] else 'reserved family uploader' if uc in ex['bad_users']
                  else 'cached Freesound test' if i in ex['fs_eval'] else 'DJ-effect held-out uploader' if uc in ex['dj_users']
                  else 'run 7 held-out id' if i in ex['r7_held'] else 'already in run 7 training' if i in ex['r7_train']
                  else 'already in the cached Freesound source' if i in ex['fs_train'] else 're-hosted by ESC-50 / US8K / Nonspeech7k' if i in ex['rehost']
                  else 'uploader cap' if per_user[t][uc] >= 15 else 'tag cap' if mapped[t] >= 400 else None)
        if reason: why[reason] += 1; continue
        per_user[t][uc] += 1; mapped[t] += 1; keep.append((t, i, u, lic, round(float(r['score']), 3)))
    print(f'NC supplement: {len(keep)} rows kept; removed: ' + ', '.join(f'{k} {v}' for k, v in why.most_common()), flush=True)
    if not keep: return None, dict(why)
    sounds = defaultdict(lambda: {'tags': set(), 'score': 0})
    for t, i, u, lic, s in keep:
        sounds[i]['tags'].add(t); sounds[i].update(user=u, lic=lic); sounds[i]['score'] = max(sounds[i]['score'], s)
    def uid(item):
        u, s = item; page = st.fetch(f'https://freesound.org/people/{urllib.parse.quote(u)}/sounds/{s}/', timeout=60)
        m = page and re.search(rb'cdn\.freesound\.org/previews/\d+/\d+_(\d+)-hq\.mp3', page)
        return u, m and m.group(1).decode()
    first = {}
    for i, v in sounds.items(): first.setdefault(v['user'], i)
    with ThreadPoolExecutor(6) as pool: uids = dict(pool.map(uid, first.items()))
    def audio(i):
        u = uids.get(sounds[i]['user']); b = u and st.fetch(f'https://cdn.freesound.org/previews/{i // 1000}/{i}_{u}-hq.mp3')
        return i, b if b and len(b) >= 4000 else None
    out = st.Out('nc-supplement'); got = 0
    with ThreadPoolExecutor(8) as pool:
        for i, b in pool.map(audio, sorted(sounds)):
            if not b: continue
            v = sounds[i]; got += 1
            out.add({'id': f'freesound:{i}', 'source': 'freesound', 'group': f"freesound-user:{v['user']}", 'split': 'train', 'tags': '|'.join(sorted(v['tags'])),
                     'licence': v['lic'], 'score': v['score'], 'url': f"https://freesound.org/people/{v['user']}/sounds/{i}/", 'route': 'ced-mapped-nc'}, b, 'mp3')
    folder = out.close({'removed': dict(why), 'sounds': len(sounds), 'staged': got, 'note': 'CED mapped CC BY-NC rows; unreviewed'})
    st.upload(folder, f'{IN}/nc-supplement', f'Run 9 NC supplement: {got} sounds')   # beside the staged parts, so RUN9_DATA picks it up
    return f'{IN}/nc-supplement', dict(why)


def main():
    if not api.repo_info(REPO, repo_type='dataset').private: sys.exit('staging repo is not private; refusing')
    st, sha = load_stage()
    parts = sorted({os.path.dirname(f) for f in api.list_repo_files(REPO, repo_type='dataset')
                    if f.startswith(IN + '/') and f.endswith('/manifest.csv') and not f.startswith(IN + '/nc-supplement/')})
    print('staged parts:', parts, flush=True)
    staged = []
    for p in parts:
        rows = list(csv.DictReader(open(hf_hub_download(REPO, f'{p}/manifest.csv', repo_type='dataset'))))
        staged += [dict(r, part=p) for r in rows]
    if api.file_exists(REPO, f'{IN}/nc-supplement/manifest.csv', repo_type='dataset'):   # staged by an earlier attempt
        nc_folder, nc_why = f'{IN}/nc-supplement', {'note': 'reused the NC supplement staged by an earlier run'}
    else:
        nc_folder, nc_why = (stage_nc(st, sha, staged) if TARGETS else (None, {}))
    if nc_folder: parts.append(nc_folder)
    from huggingface_hub import snapshot_download
    snapshot_download(REPO, repo_type='dataset', allow_patterns=[f'{p}/*' for p in parts], local_dir=LOCAL, max_workers=16)
    ids = {int(r['id'].split(':')[1]) for p in parts for r in csv.DictReader(open(os.path.join(LOCAL, p, 'manifest.csv')))
           if r['source'] == 'freesound'}
    meta = freesound_meta(ids)
    print('downloaded', parts, flush=True)

    items = []
    for p in parts:
        rows, blobs = read_part(p)
        with ThreadPoolExecutor(2 * (os.cpu_count() or 4)) as pool:
            hashes = list(pool.map(lambda r: (hashlib.sha256(blobs[r['file']]).hexdigest(), *pcm_hash(blobs[r['file']])) if r.get('file') in blobs else (None, None, 0.0, False), rows))
        for r, (enc, pcm, secs, hit) in zip(rows, hashes):
            items.append(dict(r, part=p, encoded_sha256=enc or '', pcm_sha256=pcm or '', seconds=secs, _extra_md5=hit))
        print(f'{p}: {len(rows)} items hashed', flush=True)

    # identical decoded audio = one sound
    by_pcm = defaultdict(list)
    for r in items:
        r['keep'], r['drop_reason'] = '1', ''
        if not r['pcm_sha256']: r['keep'], r['drop_reason'] = '0', 'missing or undecodable audio'; continue
        by_pcm[r['pcm_sha256']].append(r)
    # other held-out test sets (EXTRA_EXCL): id, uploader or decoded-audio match drops a training copy
    for r in items:
        if r['keep'] != '1' or r['split'] != 'train': continue
        fid = int(r['id'].split(':')[1]) if r['source'] == 'freesound' and r['id'].split(':')[1].isdigit() else None
        user = r['group'].removeprefix('freesound-user:').casefold() if r['source'] == 'freesound' else None
        if r['_extra_md5'] or fid in EXTRA['ids'] or (user and user in EXTRA['users']):
            r['keep'], r['drop_reason'] = '0', 'in another held-out test set'
    dup_groups = 0
    for h, rs in by_pcm.items():
        if len(rs) < 2: continue
        dup_groups += 1
        held = [r for r in rs if r['split'] == 'heldout']
        if held:
            for r in rs:
                if r['split'] != 'heldout': r['keep'], r['drop_reason'] = '0', f"same audio as held-out {held[0]['id']}"
            rs = held
        first = rs[0]
        for r in rs[1:]:
            r['keep'], r['drop_reason'] = '0', f"duplicate audio of {first['id']}"
            first['tags'] = '|'.join(sorted(set(first['tags'].split('|')) | set(r['tags'].split('|'))))
    # an uploader or other group on both sides after merging is a leak: report it, drop the training copies
    sides = defaultdict(set)
    for r in items:
        if r['keep'] == '1': sides[r['group']].add(r['split'])
    for r in items:
        if r['keep'] == '1' and r['split'] == 'train' and len(sides[r['group']]) > 1:
            r['keep'], r['drop_reason'] = '0', 'group also held out'

    cols = ['id', 'url', 'creator', 'licence', 'licence_class', 'encoded_sha256', 'pcm_sha256', 'seconds', 'split', 'group', 'tags',
            'label_evidence', 'route', 'score', 'source', 'part', 'file', 'keep', 'drop_reason']
    tmp = tempfile.mkdtemp()
    with open(os.path.join(tmp, 'manifest-audited.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, cols, extrasaction='ignore'); w.writeheader()
        for r in items:
            r['creator'] = r['group'].removeprefix('freesound-user:') if r['source'] == 'freesound' else r.get('group', '')
            r['licence_class'] = lic_class(r.get('licence')); r['label_evidence'] = evidence(r, meta)
            w.writerow(r)
    kept = [r for r in items if r['keep'] == '1']
    per_tag = defaultdict(Counter)
    for r in kept:
        for t in r['tags'].split('|'):
            if t: per_tag[t][(r['split'], r['licence_class'])] += 1
    summary = {
        'in': IN, 'run9_sha': sha, 'items': len(items), 'kept': len(kept), 'duplicate_audio_groups': dup_groups,
        'dropped': Counter(re.sub(r' \S+$', '', r['drop_reason']) if r['drop_reason'].startswith(('same audio', 'duplicate audio')) else r['drop_reason']
                           for r in items if r['keep'] == '0'),
        'nc_supplement_removed': nc_why,
        'licence_class': {f'{sp}_{lc}': n for (sp, lc), n in sorted(Counter((r['split'], r['licence_class']) for r in kept).items())},
        'tags': {t: {f'{sp}_{lc}': n for (sp, lc), n in sorted(c.items())} for t, c in sorted(per_tag.items())},
        'targets_without_training_items': sorted(t for t in TARGETS if not any(sp == 'train' for sp, _ in per_tag.get(t, {}))),
        'note': 'Nobody has listened to these clips. Open-vocab round-19 test ids are not removed (not available here).',
    }
    json.dump(summary, open(os.path.join(tmp, 'summary.json'), 'w'), indent=1, default=str)
    api.upload_folder(repo_id=REPO, repo_type='dataset', folder_path=tmp, path_in_repo=OUT, commit_message=f'Audit run 9 staging ({len(kept)} of {len(items)} kept)')
    print(json.dumps({k: v for k, v in summary.items() if k != 'tags'}, default=str), flush=True)
    print('AUDIT_DONE', flush=True)


if __name__ == '__main__':
    main()
