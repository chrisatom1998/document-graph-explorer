"""Stage round A's bird audio into the private dataset (cpu-upgrade HF job via hf-stage-job.sh; no GPU).

  ff1010bird (Bird Audio Detection challenge, archive.org ff1010bird; labels figshare 10853303; CC BY 4.0): 7,690 ten-second
    Freesound field recordings, each marked hasbird 0/1 by hand. itemid is the Freesound sound id, so each clip is
    grouped by its Freesound uploader and run through every Freesound exclusion (FSD50K eval, the reserved test
    families, the cached Freesound test, every held-out uploader of the staged Freesound/run 9/DJ-effect sets). A
    held-out clip must also be new: nothing any training source already holds.
  Warblr10k (archive.org warblrb10k_public; labels figshare 10853306; CC BY 4.0): 8,000 ten-second smartphone recordings
    from UK users. Warblr publishes no user or location ids, so each recording is its own group (a known limit: two
    recordings by one person can land on different sides).
  The held-out rule is in docs/evaluations/bird-heldout-2026-10-31/reserved-test-families.json: 15% of groups.

Labels: hasbird=1 -> bird ambience and animal sound present; hasbird=0 -> bird ambience absent (animal sound unknown).
Output (private repo only): <OUT>/audio-NNN.tar shards of <id>.opus (32 kHz mono, 96 kbit/s), manifest.csv,
summary.json, train-ids.txt.

  python3 stage-birds.py --repo cmjatom/dge-private-train --out birds/v1 [--limit 200 --dry-run]
"""
import argparse, csv, hashlib, io, json, os, sys, urllib.request, zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import round_abc as R

# Labels: figshare is the canonical copy but refuses scripted downloads (403); the fallback is a GitHub copy pinned to a
# commit whose md5 must match (three unrelated repos carry the same ff1010bird file; its ids equal the zip's exactly).
GH = 'https://raw.githubusercontent.com/EliaDamen/HomeworkSelected/8c71c5bc23c18bd9832cae548bb0d1784bc19261/'
SETS = {
    'ff1010bird': {'audio': 'https://archive.org/download/ff1010bird/ff1010bird_wav.zip', 'audio_md5': '1307223a4d18b2e712140241e29d4881',
                   'labels': ['https://ndownloader.figshare.com/files/10853303', GH + 'ff1010bird_metadata_2018.csv'], 'labels_md5': 'e4c49685d224d3033aa5044b7db96eca',
                   'licence': 'CC BY 4.0 (archive.org item ff1010bird licenseurl; Bird Audio Detection challenge, Freesound field recordings)'},
    'warblr10k': {'audio': 'https://archive.org/download/warblrb10k_public/warblrb10k_public_wav.zip', 'audio_md5': '7b6b63ac88268f2bbe533435dbc03a77',
                  'labels': ['https://ndownloader.figshare.com/files/10853306', GH + 'warblrb10k_public_metadata_2018.csv'], 'labels_md5': 'a2755d3c21df6ebba97e9bc09e97772e',
                  'licence': 'CC BY 4.0 (archive.org item warblrb10k_public licenseurl; Bird Audio Detection challenge, Warblr)'},
}


def labels_csv(s):
    """(rows, url used): the first label source that downloads and whose md5 matches."""
    for url in s['labels']:
        try: data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (DGE research)'}), timeout=300).read()
        except Exception as e: print(f'  {url}: {e}', flush=True); continue
        if hashlib.md5(data).hexdigest() == s['labels_md5']: return list(csv.DictReader(io.StringIO(data.decode()))), url
        print(f'  {url}: md5 {hashlib.md5(data).hexdigest()} != {s["labels_md5"]}, not used', flush=True)
    raise SystemExit(f"no label source for {s['audio']} matched its md5; refusing")
RULE = json.load(open(os.path.join(R.ROOT, 'docs', 'evaluations', 'bird-heldout-2026-10-31', 'reserved-test-families.json')))['birdHeldoutRule']


def bird_split(group):
    return R.group_split(group, RULE['salt'], RULE['heldPct'], 10)


def plan_ff1010(rows, users, ex):
    """[(row, split, group, reason)] for ff1010bird: grouped by Freesound uploader, every Freesound exclusion applied."""
    out = []
    for r in rows:
        sid = int(r['itemid']); u = users.get(sid)
        group = f'freesound-user:{u}' if u else f'freesound-sound:{sid}'
        split = bird_split(group)
        out.append((r, split, group, R.freesound_reason(sid, u, ex, 'heldout' if split == 'heldout' else 'train')))
    return out




def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', default='cmjatom/dge-private-train'); ap.add_argument('--out', default='birds/v1')
    ap.add_argument('--work', default=os.environ.get('TMPDIR', '/tmp') + '/birds'); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', choices=list(SETS)); ap.add_argument('--dry-run', action='store_true', help='no audio written, no upload')
    a = ap.parse_args()
    reserved = R.reserved_lists()
    if 'docs/evaluations/bird-heldout-2026-10-31/reserved-test-families.json' not in reserved['_files']: raise SystemExit('bird held-out rule missing')
    print(R.check_not_a_pack(list(SETS)), flush=True)
    api = None
    if not a.dry_run:
        from huggingface_hub import HfApi
        api = HfApi(); R.require_private(api, a.repo)
    ex, users = R.freesound_exclusions(extra_ids=[l.strip() for l in open(os.environ['FSM_IDS'])] if os.environ.get('FSM_IDS') else ())
    print('exclusions: ' + ', '.join(f'{k} {len(ex[k])}' for k in R.EXCLUSION_KEYS) + f"; manifests {ex['_sources']['manifests']}", flush=True)
    os.makedirs(a.work, exist_ok=True); st = R.Stager(a.work, a.dry_run, codec='opus'); dropped = Counter()
    with ThreadPoolExecutor(8) as pool:
        for name, s in SETS.items():
            if a.only and a.only != name: continue
            labels, label_url = labels_csv(s)
            if name == 'ff1010bird': planned = plan_ff1010(labels, users, ex)
            else: planned = [(r, bird_split(f"warblr:{r['itemid']}"), f"warblr:{r['itemid']}", None) for r in labels]
            for _, sp, _, why in planned:
                if why: dropped[f'{name} {sp}: {why}'] += 1
            planned = [p for p in planned if not p[3]]
            if a.limit: planned = sorted(planned, key=lambda p: R.h('limit', p[0]['itemid']))[:a.limit]
            zpath = os.path.join(a.work, f'{name}.zip')
            md5 = R.fetch_ranges(s['audio'], zpath, conns=8)
            if md5 != s['audio_md5']: raise SystemExit(f'{name} zip md5 {md5} != archive.org {s["audio_md5"]}; refusing')
            z = zipfile.ZipFile(zpath)
            members = {os.path.basename(n)[:-4]: n for n in z.namelist() if n.endswith('.wav')}
            def items():
                for r, sp, group, _ in planned:
                    m = members.get(r['itemid'])
                    if m is None: dropped[f'{name}: listed but not in the zip'] += 1; continue
                    present, absent = R.bird_labels(r['hasbird'])
                    yield ({'id': f"{name}:{r['itemid']}", 'dataset': name, 'url': f"{s['audio']}#{m}", 'licence': s['licence'],
                            'group': group, 'split': sp, 'tags': ';'.join(present), 'absent': ';'.join(absent),
                            'label_evidence': f"{name} hasbird={r['hasbird']} (hand label, {label_url}, md5 {s['labels_md5']})"}, z.read(m))
            st.run(pool, items()); z.close(); os.remove(zpath)
            print(f'  {name}: {len(planned)} planned; staged so far {len(st.rows)}', flush=True)
    rows = st.finish(); ngroups = R.check_groups(rows); R.assert_reserved_held(rows, reserved)
    R.write_manifest(rows, os.path.join(a.work, 'manifest.csv'))
    open(os.path.join(a.work, 'train-ids.txt'), 'w').write(''.join(r['id'] + '\n' for r in rows if r['split'] != 'heldout'))
    summary = {'rows': len(rows), 'groups': ngroups, 'dropped': dict(dropped, **st.drop), 'droppedConflicts': len(st.rows) - len(rows),
               'bySplit': {f'{d}/{s}': c for (d, s), c in sorted(Counter((r['dataset'], r['split']) for r in rows).items())},
               'birdPresent': {s: sum('bird ambience' in r['tags'] for r in rows if r['split'] == s) for s in ('train', 'val', 'heldout')},
               'licences': sorted({r['licence'] for r in rows}), 'reservedLists': sorted(reserved['_files']), 'exclusionManifests': ex['_sources']['manifests'],
               'fsmIdsChecked': bool(os.environ.get('FSM_IDS')), 'repoSha': os.environ.get('REPO_SHA', ''), 'limit': a.limit}
    json.dump(summary, open(os.path.join(a.work, 'summary.json'), 'w'), indent=1); print(json.dumps(summary, indent=1), flush=True)
    if api:
        R.require_private(api, a.repo)
        api.upload_folder(repo_id=a.repo, repo_type='dataset', folder_path=a.work, path_in_repo=a.out,
                          allow_patterns=['audio-*.tar', 'manifest.csv', 'summary.json', 'train-ids.txt'], commit_message=f'stage-birds {os.environ.get("REPO_SHA", "")[:7]}')
        print(f'uploaded {len(rows)} clips to {a.repo}:{a.out} (private)', flush=True)


if __name__ == '__main__':
    main()
