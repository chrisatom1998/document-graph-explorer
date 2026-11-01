"""Stage round B's guitar-effect audio into the private dataset (cpu-upgrade HF job via hf-stage-job.sh; no GPU).

  IDMT-SMT-Audio-Effects (Zenodo 7544032): monophonic and polyphonic electric-guitar notes through 11 effects.
    Only the four guitar inner zips are opened; 'Bass monophon*.zip' are never downloaded (idmt-bass is a forbidden
    set). Guitar 2 (instrument settings 8-9) is the held-out guitar: none of its clips is ever trained on, and a sample
    of it becomes eval-distorted. Guitar 1 trains; validation picks whole notes, so every effect version of one note
    stays together.
  Medley-solos-DB (Zenodo 3464194): only its test part (solosDb). Its training and validation parts are cut from
    MedleyDB multitracks, which can share songs with the 417-song stem judge, so they are never opened. Each song id is
    a group; the songs in docs/evaluations/distorted-heldout-2026-10-31/reserved-test-families.json are held out.

Output (private repo only, raw audio never public): <OUT>/audio-NNN.tar shards of <id>.flac (32 kHz mono), <OUT>/manifest.csv (one row
per clip: url, licence, checksums, label evidence, group, split), <OUT>/summary.json, <OUT>/train-ids.txt.

  python3 stage-guitarfx.py --repo cmjatom/dge-private-train --out guitarfx/v1 [--limit 200 --dry-run]
"""
import argparse, csv, hashlib, io, json, os, sys, tarfile, tempfile, urllib.request, zipfile, zlib
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import round_abc as R

IDMT_RECORD, IDMT_ZIP, IDMT_MD5 = 7544032, 'IDMT-SMT-AUDIO-EFFECTS.zip', '91e845a1b347352993ebd5ba948d5a7c'
IDMT_INNER = ['Gitarre monophon.zip', 'Gitarre monophon2.zip', 'Gitarre polyphon.zip', 'Gitarre polyphon2.zip', 'Gitarre_polyphon2.zip']
IDMT_LICENCE = 'CC BY-NC-ND 4.0 (Zenodo record 7544032; the dataset PDF says CC BY-SA); non-commercial weights only'
MEDLEY_RECORD, MEDLEY_TAR, MEDLEY_TAR_MD5 = 3464194, 'Medley-solos-DB.tar.gz', 'f5facf398793ef5c1f80c013afdf3e5f'
MEDLEY_META, MEDLEY_META_MD5 = 'Medley-solos-DB_metadata.csv', 'fda6a589c56785f2195c9227809c521a'
MEDLEY_LICENCE = 'CC BY 4.0 (Zenodo record 3464194)'
zurl = lambda rec, name: f'https://zenodo.org/records/{rec}/files/{urllib.request.quote(name)}?download=1'
SALT = 'dge-distorted-heldout-2026-10-31'
TRAIN_CAP = 600          # IDMT clips per guitar-1 effect, except drive and dry which keep all
EVAL_CAP = {'Distortion': 300, 'other': 35}   # IDMT guitar-2 sample for eval-distorted; Overdrive never (distorted unknown)
MEDLEY_EVAL_CAP = 50     # held-out clips per non-guitar instrument; held-out distorted guitar keeps all


def medley_heldout(meta_rows):
    """The held-out songs, recomputed from the rule so a changed metadata file cannot silently move a song."""
    songs = defaultdict(Counter)
    for r in meta_rows:
        if r['subset'] == 'test': songs[r['song_id']][r['instrument']] += 1
    held = []
    for inst in sorted({i for c in songs.values() for i in c}):
        ss = sorted((s for s, c in songs.items() if inst in c), key=lambda s: R.h(SALT, s))
        total, n, k = sum(songs[s][inst] for s in ss), 0, []
        for s in ss:
            if n >= 0.3 * total and len(k) >= 2: break
            k.append(s); n += songs[s][inst]
        held += k
    return sorted(held)


def medley_split(song, held):
    return 'heldout' if song in held else ('val' if R.bucket(SALT + ':val', f'medley-song:{song}') < 20 else 'train')


def idmt_split(p, held_settings):
    """Guitar 2 is held out; guitar 1 notes go to validation by a hash of the note (all effects of a note together)."""
    if p['setting'] in held_settings: return 'heldout'
    return 'val' if R.bucket(SALT + ':idmt-val', f"{p['kind']}{p['setting']}-{p['note']}") < 10 else 'train'


def idmt_keep(p, split):
    """Which parsed clips are staged: all guitar-1 drive/dry clips, TRAIN_CAP of the others; a capped held-out sample."""
    b = R.bucket(SALT + ':idmt-keep', p['file'], 100000)
    if split == 'heldout':
        if p['effect'] == 'Overdrive': return False
        cap = EVAL_CAP['Distortion'] if p['effect'] == 'Distortion' else EVAL_CAP['other']
        return ('heldout', p['effect'], b, cap)
    if p['effect'] in ('Distortion', 'Overdrive', 'NoFX'): return True
    return ('train', p['effect'], b, TRAIN_CAP)


def cap(cands):
    """Keep the `cap` lowest-hash clips per (side, effect)."""
    groups = defaultdict(list)
    for key, item in cands: groups[key[:2]].append((key[2], key[3], item))
    out = []
    for g in groups.values():
        g.sort(key=lambda t: t[0]); out += [it for _, c, it in g[:g[0][1]]]
    return out


def fetch_member(url, info, path):
    """One member of a remote zip -> path: its compressed bytes come down with parallel range requests (R.fetch_ranges),
    then are inflated here and checked against the member's CRC."""
    hdr = R._get_range(url, info.header_offset, info.header_offset + 29)
    if hdr[:4] != b'PK\x03\x04': raise SystemExit(f'{info.filename}: no local header; refusing')
    start = info.header_offset + 30 + int.from_bytes(hdr[26:28], 'little') + int.from_bytes(hdr[28:30], 'little')
    raw = path + '.raw'
    R.fetch_ranges(url, raw, start, info.compress_size)
    crc, n = 0, 0
    with open(raw, 'rb') as f, open(path, 'wb') as out:
        if info.compress_type == zipfile.ZIP_STORED: inflate = None
        elif info.compress_type == zipfile.ZIP_DEFLATED: inflate = zlib.decompressobj(-15)
        else: raise SystemExit(f'{info.filename}: compression {info.compress_type} not handled')
        while d := f.read(1 << 22):
            if inflate: d = inflate.decompress(d)
            out.write(d); crc = zlib.crc32(d, crc); n += len(d)
        if inflate:
            d = inflate.flush(); out.write(d); crc = zlib.crc32(d, crc); n += len(d)
    os.remove(raw)
    if crc != info.CRC or n != info.file_size: raise SystemExit(f'{info.filename}: CRC/size mismatch after download; refusing')


def stage_idmt(st, reserved, limit, pool):
    import importlib; pe = importlib.import_module('prepare-extra')   # HttpFile: range requests, so only guitar zips are read
    held = set(reserved['idmtAudioEffectsHeldoutInstrumentSettings'])
    outer = zipfile.ZipFile(io.BufferedReader(pe.HttpFile(zurl(IDMT_RECORD, IDMT_ZIP)), 1 << 22))
    names = {n.rsplit('/', 1)[-1]: n for n in outer.namelist()}
    for n in names:
        if n.lower().startswith('bass'): print(f'  skipping {n} (idmt-bass is a forbidden set; never downloaded)', flush=True)
    crcs = {}
    for inner in IDMT_INNER:
        if inner not in names: raise SystemExit(f'{inner} missing from {IDMT_ZIP}; contents changed, refusing')
        info = outer.getinfo(names[inner])
        if info.CRC in crcs: print(f'  {inner}: same bytes as {crcs[info.CRC]}, skipped', flush=True); continue
        crcs[info.CRC] = inner
        with tempfile.NamedTemporaryFile(suffix='.zip', dir=os.environ.get('TMPDIR', '/tmp')) as tmp:
            fetch_member(zurl(IDMT_RECORD, IDMT_ZIP), info, tmp.name)
            z = zipfile.ZipFile(tmp.name)
            cands, unknown = [], Counter()
            for n in z.namelist():
                p = R.idmt_parse(n)
                if p is None: continue
                if p['kind'] == 'B': raise SystemExit(f'bass clip {n} inside a guitar zip; refusing')
                if p['effect'] not in R.IDMT_EFFECT: unknown[p['effect']] += 1; continue
                split = idmt_split(p, held); keep = idmt_keep(p, split)
                if keep is True: cands.append((('all', n, 0, 1 << 30), (n, p, split)))
                elif keep: cands.append((keep, (n, p, split)))
            if unknown: raise SystemExit(f'{inner}: unknown effect folders {dict(unknown)}; refusing to guess labels')
            picked = [it for (k, it) in cands if k[0] == 'all'] + cap([c for c in cands if c[0][0] != 'all'])
            if limit: picked = sorted(picked, key=lambda t: R.h('limit', t[0]))[:limit]
            def one(t):
                n, p, split = t; present, absent = R.idmt_labels(p['effect'])
                guitar = R.idmt_guitar(p['setting'])
                row = {'id': f"idmt-ae:{inner.removesuffix('.zip').replace(' ', '-')}/{p['file'][:-4]}", 'dataset': 'IDMT-SMT-Audio-Effects',
                       'url': f"{zurl(IDMT_RECORD, IDMT_ZIP)}#{names[inner]}/{n}", 'licence': IDMT_LICENCE,
                       'group': f'idmt-{guitar}', 'split': split, 'tags': ';'.join(present), 'absent': ';'.join(absent),
                       'label_evidence': f"effect folder '{p['effect']}' (IDMT-SMT-Audio-Effects ground truth); instrument setting {p['setting']} = {guitar}; note {p['kind']}{p['setting']}{p['style']}-{p['note']}"}
                return row, z.read(n)
            st.run(pool, map(one, picked))
            print(f'  {inner}: {len(picked)} clips picked of {len(cands)}; staged so far {len(st.rows)}', flush=True)


def stage_medley(st, reserved, limit, pool):
    meta_bytes = urllib.request.urlopen(zurl(MEDLEY_RECORD, MEDLEY_META), timeout=120).read()
    if hashlib.md5(meta_bytes).hexdigest() != MEDLEY_META_MD5: raise SystemExit('Medley-solos-DB metadata md5 changed; refusing')
    meta = list(csv.DictReader(io.StringIO(meta_bytes.decode())))
    held = medley_heldout(meta)
    if held != sorted(reserved['medleySolosHeldoutSongIds']):
        raise SystemExit('held-out Medley songs differ from docs/evaluations/distorted-heldout-2026-10-31/reserved-test-families.json')
    by_uuid = {r['uuid4']: r for r in meta if r['subset'] == 'test'}
    eval_n = Counter(); n = 0
    if limit: src = io.BufferedReader(R.Md5Reader(urllib.request.urlopen(zurl(MEDLEY_RECORD, MEDLEY_TAR), timeout=600)), 1 << 22)   # smoke run
    else:
        local = os.path.join(os.environ.get('TMPDIR', '/tmp'), MEDLEY_TAR)
        md5 = R.fetch_ranges(zurl(MEDLEY_RECORD, MEDLEY_TAR), local)
        if md5 != MEDLEY_TAR_MD5: raise SystemExit(f'{MEDLEY_TAR} md5 {md5} != {MEDLEY_TAR_MD5}; refusing')
        src = open(local, 'rb')
    batch = []
    def flush():
        st.run(pool, batch); batch.clear()
    with src, tarfile.open(fileobj=src, mode='r|gz') as tar:
        for m in tar:
            if not m.isfile() or not m.name.endswith('.wav'): continue
            uuid = m.name.rsplit('_', 1)[-1][:-4]; r = by_uuid.get(uuid)
            if r is None: continue                                   # training/validation (MedleyDB) parts: never read
            split = medley_split(r['song_id'], held)
            if split == 'heldout' and r['instrument'] != 'distorted electric guitar':
                if eval_n[r['instrument']] >= MEDLEY_EVAL_CAP: continue
                eval_n[r['instrument']] += 1
            if limit and n >= limit: break
            present, absent = R.medley_labels(r['instrument']); n += 1
            batch.append(({'id': f'medley-solos:{uuid}', 'dataset': 'Medley-solos-DB', 'url': f'{zurl(MEDLEY_RECORD, MEDLEY_TAR)}#{m.name}',
                           'licence': MEDLEY_LICENCE, 'group': f"medley-song:{r['song_id']}", 'split': split, 'tags': ';'.join(present),
                           'absent': ';'.join(absent), 'label_evidence': f"Medley-solos-DB instrument '{r['instrument']}' (solo recording), song {r['song_id']}"},
                          tar.extractfile(m).read()))
            if len(batch) >= 256: flush()
        flush()
    if not limit: os.remove(local)
    print(f'  medley: {n} clips read; held-out sample {dict(eval_n)}', flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', default='cmjatom/dge-private-train'); ap.add_argument('--out', default='guitarfx/v1')
    ap.add_argument('--work', default=os.environ.get('TMPDIR', '/tmp') + '/guitarfx'); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', choices=['idmt', 'medley']); ap.add_argument('--dry-run', action='store_true', help='no audio written, no upload')
    a = ap.parse_args()
    reserved = R.reserved_lists()
    if 'docs/evaluations/distorted-heldout-2026-10-31/reserved-test-families.json' not in reserved['_files']: raise SystemExit('distorted held-out list missing')
    print(R.check_not_a_pack(['IDMT-SMT-Audio-Effects', 'Medley-solos-DB']), flush=True)
    print(f'forbidden sets (never read here): {R.forbidden_set_names()}', flush=True)
    api = None
    if not a.dry_run:
        from huggingface_hub import HfApi
        api = HfApi(); R.require_private(api, a.repo)
    os.makedirs(a.work, exist_ok=True)
    st = R.Stager(a.work, a.dry_run)
    with ThreadPoolExecutor(8) as pool:
        if a.only != 'medley': stage_idmt(st, reserved, a.limit, pool)
        if a.only != 'idmt': stage_medley(st, reserved, a.limit, pool)
    rows = st.finish()
    ngroups = R.check_groups(rows); R.assert_reserved_held(rows, reserved)
    R.write_manifest(rows, os.path.join(a.work, 'manifest.csv'))
    open(os.path.join(a.work, 'train-ids.txt'), 'w').write(''.join(r['id'] + '\n' for r in rows if r['split'] != 'heldout'))
    summary = {'rows': len(rows), 'groups': ngroups, 'dropped': dict(st.drop), 'droppedConflicts': len(st.rows) - len(rows),
               'bySplit': {f"{d}/{s}": c for (d, s), c in sorted(Counter((r['dataset'], r['split']) for r in rows).items())},
               'positives': dict(sorted(Counter(t for r in rows if r['split'] != 'heldout' for t in r['tags'].split(';') if t).items())),
               'heldoutPositives': dict(sorted(Counter(t for r in rows if r['split'] == 'heldout' for t in r['tags'].split(';') if t).items())),
               'licences': sorted({r['licence'] for r in rows}), 'reservedLists': sorted(reserved['_files']),
               'repoSha': os.environ.get('REPO_SHA', ''), 'limit': a.limit}
    json.dump(summary, open(os.path.join(a.work, 'summary.json'), 'w'), indent=1); print(json.dumps(summary, indent=1), flush=True)
    if api:
        R.require_private(api, a.repo)
        api.upload_folder(repo_id=a.repo, repo_type='dataset', folder_path=a.work, path_in_repo=a.out,
                          allow_patterns=['audio-*.tar', 'manifest.csv', 'summary.json', 'train-ids.txt'], commit_message=f'stage-guitarfx {os.environ.get("REPO_SHA", "")[:7]}')
        print(f'uploaded {len(rows)} clips to {a.repo}:{a.out} (private)', flush=True)


if __name__ == '__main__':
    main()
