"""Coverage idea #5: pack render.py's clips into the empty-tags/v1 layout (manifest.csv + audio-NNN.tar + summary.json).

  pack.py <render-out> <stage-dir> [--ranked ranked-tags.csv] [--part coverage/synth-presets/v1/surge-xt]

Dedupes by decoded audio (sha256 of the 16-bit PCM samples), keeps every clip of a preset in one group (all split=train),
and writes per-tag-counts.csv. Manifest columns are those of empty-tags/v1 (prepare-run9.py reads id, split, group, tags,
part, file, source) plus: absent (full-weight absences, '|'-joined; prepare-run9.py does not read it yet), synth,
synth_version, synth_licence, preset, preset_category, role, material, notes, wobble, code_made.
"""
import argparse, csv, glob, hashlib, io, json, os, tarfile
from collections import Counter, defaultdict
import numpy as np
import soundfile as sf

SYNTH, VERSION = 'Surge XT', '1.3.4 (git tag release_xt_1.3.4, commit f7b97c6; Python bindings surgepy)'
LICENCE = 'GPL-3.0 (Surge XT and the factory/third-party presets it ships); rendered audio'
TAR_SIZE = 1000
COLS = ['id', 'url', 'creator', 'licence', 'licence_class', 'encoded_sha256', 'pcm_sha256', 'seconds', 'split', 'group', 'tags',
        'label_evidence', 'route', 'score', 'source', 'part', 'file', 'keep', 'drop_reason',
        'absent', 'synth', 'synth_version', 'synth_licence', 'preset', 'preset_category', 'role', 'material', 'notes', 'wobble', 'code_made']

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('stage')
    ap.add_argument('--ranked', default=''); ap.add_argument('--part', default='coverage/synth-presets/v1/surge-xt')
    a = ap.parse_args(); os.makedirs(a.stage, exist_ok=True)
    clips = [json.loads(l) for f in sorted(glob.glob(f'{a.src}/clips-*.jsonl')) for l in open(f)]
    clips.sort(key=lambda c: c['id'])
    seen, ids, rows, dropped = {}, set(), [], Counter()
    for c in clips:
        if c['id'] in ids: dropped['repeat id (resumed shard)'] += 1; continue
        raw = open(f"{a.src}/clips/{c['file']}", 'rb').read()
        y, sr = sf.read(io.BytesIO(raw), dtype='int16')
        ph = hashlib.sha256(y.tobytes()).hexdigest()
        if ph in seen: dropped['same decoded audio as another clip'] += 1; continue
        seen[ph] = c['id']; ids.add(c['id'])
        rows.append((c, raw, ph))
    tars, man = {}, []
    for k, (c, raw, ph) in enumerate(rows):
        tname = f'audio-{k // TAR_SIZE:03d}.tar'
        if tname not in tars: tars[tname] = tarfile.open(f'{a.stage}/{tname}', 'w')
        ti = tarfile.TarInfo(c['file']); ti.size = len(raw); tars[tname].addfile(ti, io.BytesIO(raw))
        man.append({'id': c['id'], 'url': f"https://github.com/surge-synthesizer/surge/tree/release_xt_1.3.4/resources/data/{c['preset']}",
                    'creator': f"surge-xt:{c['author']}", 'licence': LICENCE, 'licence_class': 'open',
                    'encoded_sha256': hashlib.sha256(raw).hexdigest(), 'pcm_sha256': ph, 'seconds': c['seconds'], 'split': 'train',
                    'group': f"surge-xt:{c['preset']}", 'tags': '|'.join(c['tags']),
                    'label_evidence': f"code-rendered: Surge XT preset {c['category']}/{c['name']} played as {c['material']}; labels from "
                                      f"the preset map (folder, name, measured patch facts); not listened",
                    'route': 'code-rendered (real Surge XT preset); training supplement only', 'score': '', 'source': 'surge-xt-render',
                    'part': a.part, 'file': f"{tname}/{c['file']}", 'keep': 1, 'drop_reason': '',
                    'absent': '|'.join(c['absent']), 'synth': SYNTH, 'synth_version': VERSION, 'synth_licence': 'GPL-3.0',
                    'preset': c['preset'], 'preset_category': c['category'], 'role': c['role'], 'material': c['material'],
                    'notes': c['notes'], 'wobble': json.dumps(c['wobble']) if c['wobble'] else '', 'code_made': 1})
    for t in tars.values(): t.close()
    with open(f'{a.stage}/manifest.csv', 'w', newline='') as fh:
        w = csv.DictWriter(fh, COLS); w.writeheader(); [w.writerow(m) for m in man]
    pos, neg, presets = Counter(), Counter(), defaultdict(set)
    for m in man:
        for t in m['tags'].split('|'): pos[t] += 1; presets[t].add(m['preset'])
        for t in filter(None, m['absent'].split('|')): neg[t] += 1
    before = {}
    if a.ranked:
        for r in csv.DictReader(open(a.ranked)): before[r['tag']] = r['train']
    tags = sorted(set(pos) | set(neg), key=lambda t: (-pos[t], t))
    with open(f'{a.stage}/per-tag-counts.csv', 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['tag', 'clips_present', 'presets_present', 'clips_absent', 'train_clips_before (ranked-tags 2026-10-10)'])
        for t in tags: w.writerow([t, pos[t], len(presets[t]), neg[t], before.get(t, '')])
    summ = {'part': a.part, 'staged': len(man), 'presets': len({m['preset'] for m in man}), 'dropped': dict(dropped),
            'tags_train': {t: pos[t] for t in tags if pos[t]}, 'absent_train': {t: neg[t] for t in tags if neg[t]},
            'seconds_total': round(sum(float(m['seconds']) for m in man), 1), 'synth': f'{SYNTH} {VERSION}', 'licence': LICENCE,
            'note': 'train only; code-rendered from real synth presets, a training supplement: tags must still pass real held-out clips; unreviewed'}
    json.dump(summ, open(f'{a.stage}/summary.json', 'w'), indent=1)
    print(json.dumps({k: v for k, v in summ.items() if k not in ('absent_train',)}, indent=1))

if __name__ == '__main__':
    main()
