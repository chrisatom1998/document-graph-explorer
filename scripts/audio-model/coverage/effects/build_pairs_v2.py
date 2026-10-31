"""Effect pairs v2: dry/wet TRAIN pairs for 8 more effect tags (glitch effect, chops, vocal chops, vocoder vocal, pulsing,
wobbling, rising, falling), the ones v1 (build_pairs.py) and round 13's code-made renders don't cover.

  python3 -I build_pairs_v2.py plan <manifest-dir> <out plan.csv>
  python3 -I build_pairs_v2.py render <plan.csv> <src-dir> <out-dir> [--workers 8] [--limit N]

<manifest-dir> / <src-dir> mirror cmjatom/dge-private-train: round13/manifest-v1.csv (+ round13/<part>/audio-NNN.tar),
run9/v1-audit/manifest-audited.csv (+ run9/v1/labelled/), empty-tags/v1/<part>/manifest.csv, coverage/effect-pairs/plan.csv.
Output: <out-dir>/<tag>/manifest.csv + audio-NNN.tar + summary.json, the v1 layout (prepare-run9.py --prefix fx --no-renders).

Sources are TRAIN rows only (split=train, keep=1): round 13's Looperman, VocalSet (held-out singers already dropped),
Dagstuhl choir and E-GMD (drummer7 never staged); run 9's labelled Karoryfer, tabla and Groove MIDI;
empty-tags NSynth train notes and CSD choir. Never used: Freesound (noisy words, held-out uploaders), VSCO-2 (inside
VCSL, a judge set), anything code-made, any clip whose own tags or title already name an effect, and any clip v1 used.
Each source clip feeds one tag; its dry and wet copies share its group, so they always land in the same split.
Code-applied processing on real audio is a supplement: a tag still has to pass on real held-out clips.
"""
import argparse, csv, hashlib, json, os, random, re, sys
from collections import Counter, defaultdict
from multiprocessing import Pool
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import effects_v2 as E2  # noqa: E402
import build_pairs as BP  # noqa: E402
from build_pairs import KNOWN, RATE, TarWriter, flac, read_source  # noqa: E402
from select_sources import EFFECTISH  # noqa: E402

h = lambda *p: int(hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()[:12], 16)
PREFIX = 'coverage/effect-pairs/v2'
V2_TAGS = ['vocal chops', 'chops', 'vocoder vocal', 'glitch effect', 'pulsing', 'wobbling', 'rising', 'falling']
# a source already carrying any of these is not a clean dry copy for v2
SKIP_TAGS = EFFECTISH | set(V2_TAGS) | {'gliding', 'swelling', 'wobble bass', 'bass growl', 'acid synth', 'acid bass', 'vocal-like synth',
                                        'sound effect', 'texture', 'beatbox', 'vinyl scratch', 'noise', 'siren'}
SKIP_TITLE = re.compile(r'chop|vocod|glitch|stutter|revers|pitch|tune|robot|talkbox|gate|tremolo|wobbl|wub|lfo|ris(?:e|ing)|fall|puls|drop|sweep|'
                        r'fx|effect|filter|flang|phase|crush|bitcrush|distort|stretch', re.I)
TARGET = {t: 500 for t in V2_TAGS}
MIX = {
    'vocal chops': {'vocal': 1.0},
    'chops': {'loop': .55, 'synthloop': .45},
    'vocoder vocal': {'vocal': 1.0},
    'glitch effect': {'loop': .35, 'synthloop': .3, 'vocal': .2, 'note': .15},
    'pulsing': {'pad': .6, 'vocal': .2, 'note': .2},
    'wobbling': {'pad': .5, 'vocal': .2, 'note': .2, 'synthloop': .1},
    'rising': {'pad': .35, 'vocal': .25, 'note': .2, 'synthloop': .2},
    'falling': {'pad': .35, 'vocal': .25, 'note': .2, 'synthloop': .2},
}
MIN_SEC = {'vocal chops': 2.5, 'chops': 3.0, 'vocoder vocal': 1.5, 'glitch effect': 1.0, 'pulsing': 1.5, 'wobbling': 1.5, 'rising': 1.0, 'falling': 1.0}
PER_GROUP = 12
PER_GROUP_TAG = {'vocal chops': 30, 'vocoder vocal': 30}
CLEAN = {'vocalset', 'dagstuhl', 'csd', 'egmd', 'nsynth', 'karoryfer', 'tabla', 'gmd'}
STEADY = {'egmd', 'gmd', 'tabla'}   # recordings with no pitch glides, vibrato or tremolo of their own
# a wet copy of one effect can plausibly also sound like these: never a sure absence on it
NEAR = {'glitch effect': {'stutter effect', 'bitcrushed', 'chops', 'reverse effect'}, 'chops': {'stutter effect', 'glitch effect'},
        'vocal chops': {'chops', 'stutter effect', 'glitch effect', 'pitched vocal'}, 'vocoder vocal': {'vocal-like synth', 'voice'},
        'pulsing': {'wobbling', 'rhythmic', 'stutter effect'}, 'wobbling': {'pulsing', 'filter sweep', 'filtered', 'chorused', 'flanged', 'wobble bass'},
        'rising': {'riser', 'gliding', 'pitched vocal'}, 'falling': {'downlifter', 'sub drop', 'record stop', 'gliding', 'pitched vocal'}}
# own tags a wet copy loses: a time edit breaks a held note or a sequence, a vocoder replaces the voice
DROP = {'chops': {'synth arpeggio', 'synth sequence', 'breakbeat', 'drum fill', 'sustained'}, 'vocal chops': {'vocal vowel', 'spoken phrase', 'sustained'},
        'glitch effect': {'sustained'}, 'pulsing': {'sustained'}, 'vocoder vocal': None, 'wobbling': set(), 'rising': set(), 'falling': set()}
ALSO = {'vocal chops': {'voice'}}


def bpm_of(row):
    m = re.search(r'(\d{2,3})\s*bpm', row.get('evidence', '') + ' ' + row['file'], re.I)
    return float(m.group(1)) if m and 60 <= float(m.group(1)) <= 200 else None


def kind_of(r, tags):
    s, t, sec = r['source'], set(tags), r['seconds']
    if s in ('vocalset', 'dagstuhl', 'csd'): return 'vocal'
    if s in ('egmd', 'gmd'): return 'loop'
    if s == 'nsynth' or s == 'karoryfer': return 'note'
    if s == 'tabla': return 'loop' if sec >= 3 else 'note'
    if s == 'looperman':
        if t & {'voice', 'choir'} and not t & {'synthesizer'}: return 'vocal' if 'voice' in t else 'pad'
        if t & {'drum loop', 'percussion loop', 'breakbeat'}: return 'loop'
        if t & {'synth chord', 'synth drone'} or tags == ['synthesizer']: return 'pad'
        if t & {'synthesizer', 'bass', 'bell'}: return 'synthloop'
    return None


def load_rows(mdir):
    rows = []
    def add(x, part, source=None):
        rows.append(dict(part=part, file=x['file'], id=x['id'], source=source or x['source'], group=x['group'], tags=x['tags'],
                         licence=x['licence'], creator=x['creator'], url=x['url'], seconds=float(x['seconds'] or 0),
                         pcm=x.get('pcm_sha256', ''), evidence=x.get('label_evidence', '')))
    for x in csv.DictReader(open(os.path.join(mdir, 'round13/manifest-v1.csv'))):
        if x['split'] != 'train' or x['keep'] != '1': continue
        if x['part'] in ('looperman-v1', 'vocal-v1/vocalset', 'vocal-v1/dagstuhl', 'egmd-v2'):
            add(x, 'round13/' + x['part'], source={'vocal-v1/dagstuhl': 'dagstuhl'}.get(x['part']))
    for x in csv.DictReader(open(os.path.join(mdir, 'run9/v1-audit/manifest-audited.csv'))):
        if x['part'].endswith('labelled') and x['split'] == 'train' and x['keep'] == '1' and x['source'] in ('karoryfer', 'tabla', 'gmd'):
            add(x, x['part'])
    for part in ('nsynth', 'csd'):
        for x in csv.DictReader(open(os.path.join(mdir, f'empty-tags/v1/{part}/manifest.csv'))):
            if x['split'] == 'train' and x['keep'] == '1': add(x, x['part'])
    return rows


def validation_group(group):
    """Match prepare-run9.py's group-only validation partition for both audio inputs."""
    return int(hashlib.sha256(f'dge-run9-val|{group}'.encode()).hexdigest()[:8], 16) % 5 == 0


def plan(a):
    rows = load_rows(a.mdir)
    v1_ids = {x['id'] for x in csv.DictReader(open(os.path.join(a.mdir, 'coverage/effect-pairs/plan.csv')))}
    pool = defaultdict(list); skipped = Counter(); seen_pcm = set()
    for r in rows:
        tags = [t for t in r['tags'].split('|') if t]
        if r['id'] in v1_ids: skipped['used by v1'] += 1; continue
        if r['pcm'] and r['pcm'] in seen_pcm: skipped['same audio'] += 1; continue
        if set(tags) & SKIP_TAGS: skipped['effect in own tags'] += 1; continue
        if r['source'] == 'looperman' and SKIP_TITLE.search(r['evidence'].split('title:', 1)[-1]): skipped['effect in title'] += 1; continue
        if r['seconds'] < .5: skipped['too short'] += 1; continue
        if not set(tags) & KNOWN: skipped['no known tag'] += 1; continue
        k = kind_of(r, tags)
        if k is None: skipped['no kind'] += 1; continue
        seen_pcm.add(r['pcm']); r['kind'] = k; pool[k].append(r)
    print('pool by kind', {k: len(v) for k, v in pool.items()}, 'skipped', dict(skipped))
    used, out = set(), []
    carriers = sorted([r for r in pool['pad'] if r['source'] == 'looperman' and 'choir' not in r['tags']], key=lambda r: h('carrier', r['id']))
    for tag in V2_TAGS:
        n_tag = Counter()
        for kind, share in MIX[tag].items():
            want = round(TARGET[tag] * share)
            cands = [r for r in pool[kind] if r['id'] not in used and r['seconds'] >= MIN_SEC[tag]]
            by_src = defaultdict(list)
            for r in sorted(cands, key=lambda r: h('fxpair-v2', tag, r['id'])): by_src[r['source']].append(r)
            per_group, got, srcs = Counter(), 0, sorted(by_src)
            while got < want and any(by_src.values()):
                for s in srcs:
                    while by_src[s]:
                        r = by_src[s].pop(0)
                        if per_group[r['group']] >= PER_GROUP_TAG.get(tag, PER_GROUP): continue
                        per_group[r['group']] += 1; used.add(r['id']); row = dict(r, effect=tag)
                        if tag == 'vocoder vocal' and h('carrier?', r['id']) % 2 == 0 and carriers:   # half get a real synth clip as carrier
                            eligible = [c for c in carriers if c['id'] not in used
                                        and validation_group(c['group']) == validation_group(r['group'])]
                            if eligible:
                                c = eligible[h('carrier-pick', r['id']) % len(eligible)]
                                used.add(c['id'])  # no other pair may consume this recording, dry or wet
                                row.update({f'carrier_{key}': c[key] for key in
                                            ('part', 'file', 'id', 'group', 'source', 'licence', 'creator', 'url')})
                        out.append(row); got += 1; break
                    if got >= want: break
            n_tag[kind] = got
        print(f'{tag}: {sum(n_tag.values())} ({dict(n_tag)})')
    cols = ['effect', 'kind', 'part', 'file', 'id', 'source', 'group', 'tags', 'licence', 'creator', 'url', 'seconds', 'evidence',
            'carrier_part', 'carrier_file', 'carrier_id', 'carrier_group', 'carrier_source', 'carrier_licence', 'carrier_creator', 'carrier_url']
    with open(a.out, 'w', newline='') as f:
        w = csv.DictWriter(f, cols, extrasaction='ignore'); w.writeheader(); w.writerows(out)
    print('plan rows', len(out))


def dry_status(effect, source):
    if effect in ('pulsing', 'wobbling', 'rising', 'falling'): return 'full' if source in STEADY else 'weak'
    return 'full' if source in CLEAN else 'weak'


def labels(row, role):
    own = [t for t in row['tags'].split('|') if t in KNOWN]; eff = row['effect']
    status = {t: dry_status(t, row['source']) for t in V2_TAGS}
    if role == 'dry': present = set(own)
    else:
        drop = DROP[eff]; present = set() if drop is None else set(own) - drop
        present |= {eff} | ALSO.get(eff, set())
        for t in NEAR.get(eff, ()):
            if t in status: status[t] = 'weak'
    full = sorted(t for t in V2_TAGS if t not in present and status[t] == 'full')
    weak = sorted(t for t in V2_TAGS if t not in present and status[t] == 'weak')
    return sorted(present & KNOWN), full, weak


def work(job):
    row, src = job; r = random.Random(h('fxpair-v2', row['effect'], row['id']))
    try: x = read_source(src, dict(row, origin='private-train'))
    except Exception as e: return row, None, f'decode: {e}'
    x = BP.window(x, row['effect'], r)
    if x is None or len(x) < .5 * RATE: return row, None, 'silent or too short'
    carrier = None
    if row.get('carrier_file'):
        try: carrier = read_source(src, dict(part=row['carrier_part'], file=row['carrier_file'], origin='private-train'))[:len(x) + RATE]
        except Exception: carrier = None
    try: d, y, s = E2.apply(row['effect'], x, r, carrier=carrier, bpm=bpm_of(row))
    except Exception as e: return row, None, f'effect: {type(e).__name__} {e}'
    if d is None: return row, None, s
    if row.get('carrier_file') and s.get('carrier') == 'real synth clip': s['carrier_id'] = row['carrier_id']
    pcm_d = (np.clip(d, -1, 1) * 32767).astype(np.int16); pcm_w = (np.clip(y, -1, 1) * 32767).astype(np.int16)
    if np.array_equal(pcm_d, pcm_w): return row, None, 'no change'
    return row, dict(dry=flac(d), wet=flac(y), dry_pcm=hashlib.sha256(pcm_d.tobytes()).hexdigest(), wet_pcm=hashlib.sha256(pcm_w.tobytes()).hexdigest(),
                     seconds=round(len(d) / RATE, 3), settings=s), None


CARRIER_COLS = ['carrier_id', 'carrier_group', 'carrier_source', 'carrier_licence', 'carrier_creator', 'carrier_url']
COLS = [c for c in BP.COLS if c not in ('ir_file', 'ir_source', 'ir_licence')] + CARRIER_COLS


def provenance(row, role, settings):
    """Preserve both inputs' provenance only when a real carrier was actually used."""
    out = {k: row[k] for k in ('url', 'creator', 'licence')}
    out['licence_class'] = 'restricted' if row['source'] == 'looperman' else ('nc' if 'NC' in row['licence'] else 'open')
    out.update({k: '' for k in CARRIER_COLS})
    if role == 'wet' and settings.get('carrier_id'):
        out.update({k: row[k] for k in CARRIER_COLS})
        for key in ('url', 'creator', 'licence'):
            out[key] = ' | '.join(dict.fromkeys((row[key], row[f'carrier_{key}'])))
        if row['carrier_source'] == 'looperman':
            out['licence_class'] = 'restricted'
        elif out['licence_class'] == 'open' and 'NC' in row['carrier_licence']:
            out['licence_class'] = 'nc'
    return out


def render(a):
    rows_in = list(csv.DictReader(open(a.plan)))
    if a.limit: rows_in = rows_in[::max(1, len(rows_in) // a.limit)]
    writers, rows, fails, seen = {}, defaultdict(list), Counter(), set()
    with Pool(a.workers) as pool:
        for k, (row, res, err) in enumerate(pool.imap_unordered(work, [(r, a.src) for r in rows_in], chunksize=4)):
            if k % 250 == 0: print(f'  {k}/{len(rows_in)}', flush=True)
            if res is None: fails[row['effect'], (err or '?').split(':')[0]] += 1; continue
            if res['wet_pcm'] in seen or res['dry_pcm'] in seen: fails[row['effect'], 'duplicate audio'] += 1; continue
            seen |= {res['wet_pcm'], res['dry_pcm']}
            part = row['effect'].replace(' ', '-')
            if part not in writers: os.makedirs(os.path.join(a.out, part), exist_ok=True); writers[part] = TarWriter(os.path.join(a.out, part))
            pid = 'fxpair2:' + hashlib.sha256(('v2|' + row['effect'] + '|' + row['id']).encode()).hexdigest()[:16]
            for role in ('dry', 'wet'):
                data = res[role]; f = writers[part].add(f"{pid.split(':')[1]}_{role}.flac", data); present, full, weak = labels(row, role)
                rows[part].append({
                    'id': f'{pid}:{role}', **provenance(row, role, res['settings']),
                    'encoded_sha256': hashlib.sha256(data).hexdigest(), 'pcm_sha256': res[f'{role}_pcm'], 'seconds': res['seconds'], 'split': 'train',
                    'group': row['group'], 'tags': '|'.join(present),
                    'label_evidence': (f"dry copy of a clean train clip ({row['source']}); v2 effect tags absent by source rule" if role == 'dry' else
                                       f"code-applied {row['effect']} on the paired dry clip; settings in effect_settings; not listened"),
                    'route': 'effect-pair', 'score': '', 'source': 'fxpair', 'part': f'{PREFIX}/{part}', 'file': f, 'keep': '1', 'drop_reason': '',
                    'pair_id': pid, 'role': role, 'effect': row['effect'], 'absent_tags': '|'.join(full), 'weak_absent_tags': '|'.join(weak),
                    'effect_settings': json.dumps(res['settings'], sort_keys=True) if role == 'wet' else '',
                    'source_dataset': row['source'], 'source_id': row['id'], 'source_origin': f"cmjatom/dge-private-train {row['part']}",
                    'source_file': row['file'], 'source_tags': row['tags']})
    for w in writers.values(): w.close()
    for part, rr in rows.items():
        rr.sort(key=lambda x: x['file'])
        with open(os.path.join(a.out, part, 'manifest.csv'), 'w', newline='') as f:
            w = csv.DictWriter(f, COLS); w.writeheader(); w.writerows(rr)
        json.dump({'pairs': len(rr) // 2, 'clips': len(rr), 'hours': round(sum(float(x['seconds']) for x in rr) / 3600, 2),
                   'by_source': Counter(x['source_dataset'] for x in rr if x['role'] == 'dry'), 'groups': len({x['group'] for x in rr}),
                   'failed': {k[1]: v for k, v in fails.items() if k[0].replace(' ', '-') == part},
                   'note': 'code-applied effect on real train audio; supplement only, never counts as a real clip'},
                  open(os.path.join(a.out, part, 'summary.json'), 'w'), indent=1)
    print('pairs per tag', {p: len(v) // 2 for p, v in sorted(rows.items())}); print('failed', dict(fails))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan'); p.add_argument('mdir'); p.add_argument('out')
    p = sub.add_parser('render'); p.add_argument('plan'); p.add_argument('src'); p.add_argument('out')
    p.add_argument('--workers', type=int, default=8); p.add_argument('--limit', type=int, default=0)
    a = ap.parse_args(); plan(a) if a.cmd == 'plan' else render(a)
