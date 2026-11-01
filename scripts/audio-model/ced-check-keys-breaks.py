"""Job C: CED-base listening check of Freesound 'electric piano' and 'breakbeat' candidates (ids and scores only, no audio).

Candidates are Freesound sounds whose uploader tags name the sound (Chr0my/freesound.org metadata):
  electric piano: rhodes, fender-rhodes, wurlitzer, wurli, electric-piano, epiano, e-piano (not organ/calliope/carousel)
  breakbeat:      breakbeat, breakbeats, break-beat, amen-break, amenbreak, drum-break
Each one is checked against CED-base (mispeech/ced-base) AudioSet scores. Every sound in the public mirror
benjamin-paine/freesound-laion-640k was already scored by the private run cmjatom/dge-eval-runs
runs/ced-freesound-38026076860-1 (scripts/hf-eval/ced-freesound.py at 47cbeb6), so this job only reads those scores: no
audio is downloaded and no GPU is needed. Candidates missing from that run are counted, not guessed.
Rules (ced-confirm-rules.json at 47cbeb6): keep when the best score over the tag's confirm classes is >= confirm_min (0.3)
and speech / animal / vehicle (reject_classes) all stay < reject_max (0.5). Confirm classes: electric piano = AudioSet 154
'Electric piano'; breakbeat has no AudioSet class, so the drum classes 162 Drum kit, 163 Drum machine, 164 Drum, 165 Snare
drum and 243 Drum and bass stand in (a breakbeat must at least sound like drums).
Kept: CC0 and CC BY sounds only. Removed: every Freesound exclusion (round_abc.freesound_reason: FSD50K eval, reserved test
families, cached Freesound test, held-out uploaders of the staged Freesound / run 9 / DJ-effect sets), and for held-out
rows anything already trained or in BSD10k (Zenodo 19868804) or FSM_IDS. 15% of uploaders are held out
(salt dge-keys-breaks-heldout-2026-10-31).
Writes <OUT>/candidates.csv (id, username, tag, licence, split, ced_best, ced_reject, verdict, url) and <OUT>/summary.json
to the PRIVATE repo; refuses otherwise. Logs aggregate counts only.

  python3 ced-check-keys-breaks.py --repo cmjatom/dge-private-train --out ced/keys-breaks-2026-10-31 [--dry-run]
"""
import argparse, csv, glob, io, json, os, re, sys, urllib.request, zipfile
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import round_abc as R

CED_SHA = '47cbeb6fdc72d60cbcfa7efd5a1513a2e5ad1d6b'
CED_RUN = 'runs/ced-freesound-38026076860-1'
RULES_URL = f'https://raw.githubusercontent.com/chrisatom1998/document-graph-explorer/{CED_SHA}/scripts/hf-eval/data/ced-confirm-rules.json'
LIC = {0: 'CC0', 1: 'CC BY 4.0', 2: 'CC BY 3.0', 3: 'CC BY-NC 3.0', 4: 'CC BY-NC 4.0'}   # as stage-run9.py
OPEN = {'CC0', 'CC BY 4.0', 'CC BY 3.0'}
CONFIRM = {'electric piano': [154], 'breakbeat': [162, 163, 164, 165, 243]}
WORDS = {'electric piano': {'rhodes', 'fender-rhodes', 'wurlitzer', 'wurli', 'electric-piano', 'epiano', 'e-piano', 'electricpiano'},
         'breakbeat': {'breakbeat', 'breakbeats', 'break-beat', 'amen-break', 'amenbreak', 'drum-break'}}
NOT = {'electric piano': {'organ', 'calliope', 'carousel', 'jukebox'}, 'breakbeat': set()}
SALT = 'dge-keys-breaks-heldout-2026-10-31'
BSD10K = 'https://zenodo.org/records/19868804/files/metadata.zip?download=1'


def tag_words(tags):
    """Freesound tags (a list, or a comma/space separated string) -> lower-case words."""
    if isinstance(tags, (list, tuple)): parts = tags
    else: parts = re.split(r'[,\s]+', str(tags or ''))
    return {p.strip().lower() for p in parts if p and p.strip()}


def candidate_tags(tags):
    w = tag_words(tags)
    return sorted(t for t in WORDS if w & WORDS[t] and not w & NOT[t])


def verdict(probs, tag, rules):
    best = max(float(probs[c]) for c in CONFIRM[tag]); rej = max(float(probs[c]) for c in rules['reject_classes'])
    ok = best >= rules['confirm_min'] and rej < rules['reject_max']
    return best, rej, 'confirmed' if ok else 'rejected: listener disagrees' if best < rules['confirm_min'] else 'rejected: speech/animal/vehicle'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', default='cmjatom/dge-private-train'); ap.add_argument('--out', default='ced/keys-breaks-2026-10-31')
    ap.add_argument('--work', default=os.environ.get('TMPDIR', '/tmp') + '/keysbreaks'); ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(); os.makedirs(a.work, exist_ok=True)
    import numpy as np, pyarrow.parquet as pq
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    api = HfApi()
    if not a.dry_run: R.require_private(api, a.repo)
    rules = json.loads(urllib.request.urlopen(RULES_URL, timeout=120).read())
    meta = pq.read_table(hf_hub_download('Chr0my/freesound.org', 'freesound_parquet.parquet', repo_type='dataset'), columns=['id', 'username', 'tags:']).to_pydict()
    cands = {}
    for i, u, t in zip(meta['id'], meta['username'], meta['tags:']):
        for tag in candidate_tags(t): cands[(int(i), tag)] = u
    print(f'keyword candidates: {dict(Counter(t for _, t in cands))}', flush=True)
    bsd = set()
    try:
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(BSD10K, timeout=300).read()))
        name = next(n for n in z.namelist() if n.endswith('.csv'))
        bsd = {int(r['sound_id']) for r in csv.DictReader(io.TextIOWrapper(z.open(name)))}
    except Exception as e: print(f'BSD10k metadata unavailable ({e}); held-out rows are not checked against it', flush=True)
    fsm = [l.strip() for l in open(os.environ['FSM_IDS'])] if os.environ.get('FSM_IDS') else []
    ex, users = R.freesound_exclusions(extra_ids=list(bsd) + fsm)
    d = snapshot_download('cmjatom/dge-eval-runs', repo_type='dataset', allow_patterns=[f'{CED_RUN}/part-*/*.npz'], local_dir=os.path.join(a.work, 'ced'), max_workers=16)
    want = {i for i, _ in cands}; P, L = {}, {}
    for f in sorted(glob.glob(os.path.join(d, CED_RUN, 'part-*', '*.npz'))):
        z = np.load(f, allow_pickle=False); ids = z['freesound_id'].astype(np.int64)
        for j in np.where(np.isin(ids, list(want)))[0]:
            P[int(ids[j])] = z['probs'][j].astype(np.float32); L[int(ids[j])] = LIC.get(int(z['license'][j]), '?')
    rows, why = [], Counter()
    for (sid, tag), u in sorted(cands.items()):
        u = u or users.get(sid); group = f'freesound-user:{u}'
        split = 'heldout' if R.bucket(SALT, group) < 15 else 'train'
        if sid not in P: why[f'{tag}: not in the CED run (no score)'] += 1; continue
        if L[sid] not in OPEN: why[f'{tag}: licence {L[sid]}'] += 1; continue
        r = R.freesound_reason(sid, u, ex, split)
        if r: why[f'{tag} {split}: {r}'] += 1; continue
        best, rej, v = verdict(P[sid], tag, rules)
        rows.append({'id': sid, 'username': u, 'tag': tag, 'licence': L[sid], 'split': split, 'ced_best': round(best, 4), 'ced_reject': round(rej, 4),
                     'verdict': v, 'url': f'https://freesound.org/people/{u}/sounds/{sid}/'})
    R.check_groups([{'group': f"freesound-user:{r['username']}", 'split': r['split']} for r in rows])
    with open(os.path.join(a.work, 'candidates.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, list(rows[0]) if rows else ['id']); w.writeheader(); w.writerows(rows)
    summary = {'kept': dict(Counter(f"{r['tag']}/{r['split']}/{r['verdict']}" for r in rows)), 'removed': dict(why),
               'uploaders': dict(Counter(r['tag'] for r in {(r['tag'], r['username']): r for r in rows}.values())),
               'rules': {k: rules[k] for k in ('confirm_min', 'reject_max', 'reject_classes')}, 'confirmClasses': CONFIRM,
               'cedRun': CED_RUN, 'cedSha': CED_SHA, 'bsd10kIds': len(bsd), 'fsmIdsChecked': bool(fsm), 'exclusionManifests': ex['_sources']['manifests']}
    json.dump(summary, open(os.path.join(a.work, 'summary.json'), 'w'), indent=1); print(json.dumps(summary, indent=1), flush=True)
    if not a.dry_run:
        R.require_private(api, a.repo)
        api.upload_folder(repo_id=a.repo, repo_type='dataset', folder_path=a.work, path_in_repo=a.out, allow_patterns=['candidates.csv', 'summary.json'],
                          commit_message=f'CED check: electric piano / breakbeat candidates ({os.environ.get("REPO_SHA", "")[:7]})')
        print(f'uploaded {len(rows)} scored candidates to {a.repo}:{a.out} (private; ids and scores only)', flush=True)


if __name__ == '__main__':
    main()
