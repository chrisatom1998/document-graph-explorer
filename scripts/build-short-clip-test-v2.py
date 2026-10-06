"""Second frozen short-clip test set (0.15-2.25 s one-shots), built in two steps so the labels are human.

The first set (short-clips-2026-10-04) has been read three times and the external 80-clip bass pack
three times, so no short-clip head has a fair number any more. Every clip here comes from a pool that
no one-shot head (public/sound-model/short-clip.json) trained on, and from a family (Freesound uploader
or sample pack) that appears in neither its training items nor the first test set:
  * dj-training-sounds: Freesound clips fetched by label folder (CC0 / CC BY / Sampling+ only).
  * freesound-mined-*: Freesound clips picked by uploader tags (same licence rule).
  * Producer Space CC0: vocal one-shots and vocal drum imitations (pack = family).
Folder, tag and file names are selection hints only: they are NOT labels. Labels come from a blind
listening pass in Sound Label Studio (scripts/dj-review-server.py) against a fixed question set.

  select  - pick candidates, write opaque-named WAVs and a blind review folder (no hints shown).
  freeze  - turn the confirmed reviews into the frozen manifest + reserved families. Refuses to overwrite.

Usage:
  python3 scripts/build-short-clip-test-v2.py select
  DJ_REVIEW_DATA=artifacts/music-evaluation/short-clip-test-v2-review DJ_REVIEW_PORT=8768 DJ_REVIEW_NO_APPLY=1 \
      python3 scripts/dj-review-server.py          (listen and confirm every clip)
  python3 scripts/build-short-clip-test-v2.py freeze
"""
import glob, hashlib, json, os, random, subprocess, sys, datetime
from collections import Counter, defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MEDIA = '/Users/chrisjohnson/Documents/Media'
FP = f'{MEDIA}/dj-training-fingerprints'
W = f'{FP}/short-clips'
AUDIO = f'{FP}/short-clips-v2/bench-audio'
REVIEW = os.path.join(ROOT, 'artifacts', 'music-evaluation', 'short-clip-test-v2-review')
OUT = os.path.join(ROOT, 'docs', 'evaluations', 'short-clips-v2-2026-10-05')
OLD = os.path.join(ROOT, 'docs', 'evaluations', 'short-clips-2026-10-04')
SEED = 20261005
MIN_S, MAX_S = 0.15, 2.25
PRODUCER = f'{MEDIA}/Producer Space CC0/Producer Space/Packs'

# What the listener judges on EVERY clip. A confirmed clip without one of these marked present means it is
# absent (the listener was asked), except where unknownByDesign says the question does not apply.
QUESTIONS = [('role', 'bass hit'), ('role', 'kick'), ('role', 'snare'), ('role', 'clap'), ('role', 'hi-hat'),
             ('role', 'synth hit'), ('role', 'impact'), ('role', 'whoosh'), ('role', 'vinyl scratch'),
             ('role', 'beatbox'), ('source', 'voice')]
# Sound Label Studio groups -> benchmark dimensions, matching the first set and scripts/short-clip-displayed:
# production one-shots are 'role', sources are 'source', and the two measured character labels are 'effect'.
DIMENSION = {'production': 'role', 'source': 'source', 'character': 'character'}
EFFECT_LABELS = {'distorted', 'reverberant'}


def dimension(group, label):
    return 'effect' if group == 'character' and label in EFFECT_LABELS else DIMENSION[group]


def h(*parts):
    return hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest()


def allowed_licence(url):
    url = (url or '').lower()
    return bool(url) and 'nc' not in url.replace('licenses', '').replace('creativecommons', '') and (
        'publicdomain/zero' in url or '/by/' in url or 'sampling+' in url or url.endswith('/by/4.0/'))


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout.strip()
    try: return float(out)
    except ValueError: return None


def families_in_use():
    """Uploaders and Freesound ids any one-shot head trained on, plus the first frozen test set's reserve."""
    users, ids = set(), set()
    for i in json.load(open(f'{W}/train-items.json'))['items']:
        a = i['groups']['artist']
        if a.startswith('freesound-user:'): users.add(a.split(':', 1)[1])
        o = i['groups'].get('original', '')
        if o.startswith('freesound:'): ids.add(o.split(':', 1)[1])
    r = json.load(open(f'{OLD}/reserved-test-families.json'))
    users |= set(r['freesoundUploaders']); ids |= {str(x) for x in r['freesoundIds']}
    return users, ids


def select():
    rng = random.Random(SEED)
    used_users, used_ids = families_in_use()
    cands = []   # dict(source, hint, username/pack, fid, path, licence, url, title, group, unknownByDesign)

    # 1. dj-training-sounds (label folders)
    idx = json.load(open(f'{MEDIA}/dj-training-sounds/index.json'))['items']
    dts_ids = {str(i['id']) for i in idx}
    for i in idx:
        if i['username'] in used_users or str(i['id']) in used_ids or not allowed_licence(i.get('license')): continue
        cands.append(dict(source='dj-training-sounds', hint=i['label'], family=f"freesound-user:{i['username']}", fid=str(i['id']),
                          path=i['file'], licence=i['license'], url=i['page'], title=i['name'], unknownByDesign=[]))
    # 2. freesound-mined pools (tag-derived hints), only labels the folders above lack enough of
    seen = {}
    for m in ['freesound-mined', 'freesound-mined-2', 'freesound-mined-3', 'freesound-mined-extra']:
        d = json.load(open(f'{FP}/{m}/manifest.json')); c = d.get('clips', d); c = c if isinstance(c, list) else list(c.values())
        for x in c: seen.setdefault(str(x['freesoundId']), x)
    for fid, x in seen.items():
        labels = x['labels'] if isinstance(x['labels'], list) else [x['labels']]
        hint = next((l for l in ['808 bass', 'synth bass', 'acid bass', 'synth stab'] if l in labels), None)
        if not hint or x['username'] in used_users or fid in used_ids or fid in dts_ids or not allowed_licence(x.get('licence')): continue
        cands.append(dict(source=f"freesound-mined ({', '.join(labels)})", hint=hint, family=f"freesound-user:{x['username']}", fid=fid,
                          path=x['path'], licence=x['licence'], url=x['url'], title=x['title'], unknownByDesign=[]))
    # 3. Producer Space CC0 vocal packs (pack = family). Vocal drum imitations keep kick/snare/hi-hat UNKNOWN by design,
    #    as the first set did for AVP: they are voice and beatbox, and a listener cannot say they are "not a kick".
    vocal_packs = ['Dance Vocal Shouts', 'Dance Vocal Shouts 2', 'Spanish Dance Vocals', 'Provocative Whispers', 'Inspirational Words', 'Soulful House Vocals']
    for pack in vocal_packs + ['Vocal Percussion FX']:
        for p in sorted(glob.glob(f'{PRODUCER}/{pack}/**/*.wav', recursive=True)):
            cands.append(dict(source=f'Producer Space CC0 / {pack}', hint='vocal drum imitation' if pack == 'Vocal Percussion FX' else 'vocal one-shot',
                              family=f'producer-space:{pack}', fid=h('ps', os.path.relpath(p, PRODUCER))[:12], path=p,
                              licence='https://creativecommons.org/publicdomain/zero/1.0/', url='https://archive.org/details/producer-space-cc0-sample-library',
                              title=os.path.basename(p), unknownByDesign=[('role', 'kick'), ('role', 'snare'), ('role', 'hi-hat'), ('role', 'clap')] if pack == 'Vocal Percussion FX' else []))

    # Durations (cached), then the per-hint budget with a per-family cap, chosen by a fixed hash so the pick is reproducible.
    cache_path = f'{FP}/short-clips-v2/durations.json'; os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    for c in cands:
        if c['path'] not in cache: cache[c['path']] = duration(c['path'])
    json.dump(cache, open(cache_path, 'w'))
    cands = [c for c in cands if cache.get(c['path']) and MIN_S <= cache[c['path']] <= MAX_S]
    for c in cands: c['seconds'] = round(cache[c['path']], 4)

    BUDGET = {  # hint: (max clips, max per family)
        '808 bass': (60, 2), 'sub bass': (20, 3), 'synth bass': (10, 2), 'acid bass': (25, 1),
        'kick': (30, 5), 'snare': (25, 5), 'clap': (25, 2), 'synth stab': (30, 2),
        'impact': (15, 3), 'whoosh': (10, 3), 'vinyl scratch': (15, 3), 'glitch effect': (10, 2),
        'filtered': (6, 2), 'distorted': (6, 2), 'vocal one-shot': (30, 5), 'vocal drum imitation': (25, 25)}
    picked, per_family = [], Counter()
    for hint, (cap, per_fam) in BUDGET.items():
        pool = sorted([c for c in cands if c['hint'] == hint], key=lambda c: h('pick', c['fid']))
        n = 0
        for c in pool:
            if n >= cap: break
            if per_family[(hint, c['family'])] >= per_fam: continue
            per_family[(hint, c['family'])] += 1; picked.append(c); n += 1
    # One clip per Freesound id / file even if two hints wanted it.
    uniq = {}; [uniq.setdefault(c['path'], c) for c in picked]; picked = list(uniq.values())
    rng.shuffle(picked)

    os.makedirs(AUDIO, exist_ok=True); os.makedirs(f'{REVIEW}/audio', exist_ok=True)
    items, sidecar = [], {}
    for n, c in enumerate(picked, 1):
        iid = h('sc2', c['source'], c['fid'])[:16]   # hex only: the review server serves /audio/<hex>.wav
        wav = f'{AUDIO}/{iid}.wav'
        if not os.path.exists(wav):   # whole clip, mono 16-bit WAV at the source rate; no crop, no fade, no gain
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', c['path'], '-ac', '1', '-c:a', 'pcm_s16le', wav], check=True)
        link = f'{REVIEW}/audio/{iid}.wav'
        if not os.path.exists(link): os.link(wav, link)
        # The page shows "Clip N of 300 · <folder> · first X seconds": the folder line carries the question set.
        folder = 'judge all 11: ' + ' · '.join(l for _, l in QUESTIONS)
        items.append({'id': iid, 'title': f'Clip {n:03d}', 'preview': f'audio/{iid}.wav', 'seconds': c['seconds'], 'folder': folder,
                      'proposedLabels': {'source': [], 'production': [], 'character': []}, 'labelProvenance': 'blind listening (no hints shown)',
                      'hintReasons': [], 'automaticTags': [], 'reviewed': False})
        sidecar[iid] = {k: c[k] for k in ('source', 'hint', 'family', 'fid', 'path', 'licence', 'url', 'title', 'seconds', 'unknownByDesign')}
    scope = ('Blind short-clip test, round 2. For EVERY clip, decide each of these and tick the ones you hear: '
             + ', '.join(f'{d}:{l}' for d, l in QUESTIONS)
             + '. Add any other sound you clearly hear. Use "unsure" when you cannot tell. Confirm the clip when all eleven are judged. '
             'Folder and file names are hidden on purpose; nothing here changes the shipped model.')
    json.dump({'version': 1, 'scope': scope, 'items': items}, open(f'{REVIEW}/manifest.json', 'w'), indent=1)
    json.dump({'questions': QUESTIONS, 'seed': SEED, 'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'clips': sidecar},
              open(f'{REVIEW}/sidecar.json', 'w'), indent=1)
    if not os.path.exists(f'{REVIEW}/custom-categories.json'): json.dump([], open(f'{REVIEW}/custom-categories.json', 'w'))
    print(len(items), 'clips;', len({c['family'] for c in picked}), 'families; by hint:', dict(Counter(c['hint'] for c in picked)))


GEMINI_MIN_AGREEMENT = 0.80   # fixed before any Gemini answer was read (PREREGISTRATION.md)


def gemini_answers():
    """{clip id: {'production:bass hit': 'yes'|'no'|'unsure', ...}} from GEMINI_LABELS=<path>, or {} when unset."""
    path = os.environ.get('GEMINI_LABELS')
    if not path: return {}, None
    d = json.load(open(path)); model = next(iter(d.values()))['model'] if d else path
    return {k: v['answers'] for k, v in d.items()}, model


def agreement(gem, reviews, side):
    """Per question: how often Gemini's yes/no matches a human-confirmed clip (unsure on either side is skipped)."""
    out = {}
    for d, l in [tuple(q) for q in side['questions']]:
        key = f"{'source' if d == 'source' else 'production'}:{l}"; n = agree = 0
        for cid, r in reviews.items():
            if cid not in side['clips'] or not r.get('confirmed') or cid not in gem: continue
            g = gem[cid].get(key)
            if g not in ('yes', 'no') or (r.get('decisions') or {}).get(key) == 'unsure': continue
            human_yes = l in r['labels'].get('source' if d == 'source' else 'production', [])
            n += 1; agree += (g == 'yes') == human_yes
        out[f'{d}:{l}'] = {'compared': n, 'agreement': round(agree / n, 3) if n else None, 'accepted': bool(n >= 10 and agree / n >= GEMINI_MIN_AGREEMENT)}
    return out


def agreement_report():
    side = json.load(open(f'{REVIEW}/sidecar.json')); reviews = json.load(open(f'{REVIEW}/reviews.json'))
    gem, model = gemini_answers()
    if not gem: sys.exit('Set GEMINI_LABELS=<review dir>/gemini-<model>.json')
    print(json.dumps({'model': model, 'humanConfirmed': sum(1 for k, v in reviews.items() if v.get('confirmed') and k in side['clips']),
                      'geminiAnswered': len(gem), 'perQuestion': agreement(gem, reviews, side)}, indent=1))


def freeze():
    os.makedirs(OUT, exist_ok=True)
    manifest_path = f'{OUT}/manifest.json'
    if os.path.exists(manifest_path): sys.exit(f'{manifest_path} exists; the test split is frozen and is not rewritten.')
    side = json.load(open(f'{REVIEW}/sidecar.json')); reviews = json.load(open(f'{REVIEW}/reviews.json'))
    review_items = json.load(open(f'{REVIEW}/manifest.json'))['items']
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    reviewer = 'explicit human confirmation (blind listening in Sound Label Studio, question set in sidecar.json)'
    items, meta, stats = [], {}, Counter()
    gem, gem_model = gemini_answers(); accept = agreement(gem, reviews, side) if gem else {}
    for it in review_items:
        if it['id'] not in side['clips']: stats['not part of the blind set (left out)'] += 1; continue   # e.g. sounds added through the studio UI
        r = reviews.get(it['id']); c = side['clips'][it['id']]
        truth = {}; mode = None
        if not r or not r.get('confirmed'):
            # No human label: Gemini may stand in, question by question, only where it agreed with the human clips (pre-set rule).
            g = gem.get(it['id'])
            if not g: stats['not confirmed (left out)'] += 1; continue
            for d, l in [tuple(q) for q in side['questions']]:
                key = f"{'source' if d == 'source' else 'production'}:{l}"
                if [d, l] in c['unknownByDesign'] or (d, l) in c['unknownByDesign'] or not accept.get(f'{d}:{l}', {}).get('accepted'): continue
                if g.get(key) == 'yes': truth[(d, l)] = 'present'
                elif g.get(key) == 'no': truth[(d, l)] = 'absent'
            if not truth: stats['gemini answers not accepted (left out)'] += 1; continue
            mode = f'gemini:{gem_model}'; r = {'labels': {}, 'decisions': {}}
        if mode is None:
            for group, labels in r['labels'].items():
                for l in labels:
                    truth[(dimension(group, l), l)] = 'present'
            for key, decision in (r.get('decisions') or {}).items():
                group, l = key.split(':', 1); d = dimension(group, l)
                if decision == 'absent' and (d, l) not in truth: truth[(d, l)] = 'absent'
            # "unsure" on a question label stays unknown; every other unmarked question label is absent (the listener was asked).
            unsure = {(dimension(k.split(':', 1)[0], k.split(':', 1)[1]), k.split(':', 1)[1]) for k, v in (r.get('decisions') or {}).items() if v == 'unsure'}
            for d, l in [tuple(q) for q in side['questions']]:
                if (d, l) not in truth and (d, l) not in unsure and [d, l] not in c['unknownByDesign'] and (d, l) not in c['unknownByDesign']: truth[(d, l)] = 'absent'
            mode = 'hint-assisted' if r.get('assist') else 'blind'
        items.append({'id': it['id'], 'source': f"{c['source']}: {c['url']} ({c['licence']})",
                      'rights': {'evaluationAllowed': True, 'basis': f"per-clip licence {c['licence']}; evaluation only, audio not redistributed"},
                      'groups': {'original': f"{c['source'].split(' ')[0]}:{c['fid']}", 'artist': c['family'], 'pack': c['family'], 'sampleFamily': c['family']},
                      'transformations': ['decoded to mono 16-bit WAV at the source sample rate; whole clip, no crop, fade or gain change'],
                      'start': 0, 'end': c['seconds'],
                      'reviews': [{'reviewer': f'{reviewer}; {mode}', 'at': now, 'dimension': d, 'label': l, 'state': s} for (d, l), s in sorted(truth.items())],
                      'split': 'test', 'tier': 'one-shot'})
        meta[it['id']] = {'dataset': c['source'], 'durationSeconds': c['seconds'], 'selectionHint': c['hint'], 'family': c['family'], 'labelMode': mode, **({'assist': r['assist']} if r.get('assist') else {})}
        stats[f'labelMode:{mode}'] += 1
        stats['test'] += 1
        for (d, l), s in truth.items(): stats[f'{d}:{l}:{s}'] += 1
    json.dump({'version': 1, 'frozenAt': now, 'items': items}, open(manifest_path, 'w'), indent=1)
    json.dump(meta, open(f'{OUT}/item-meta.json', 'w'), indent=1)
    fams = {i['groups']['artist'] for i in items}
    json.dump({'purpose': 'Frozen short-clip TEST split v2. Never train, calibrate or tune on these recordings or on ANY recording from these families.',
               'freesoundIds': sorted(side['clips'][i['id']]['fid'] for i in items if i['groups']['artist'].startswith('freesound-user:')),
               'freesoundUploaders': sorted(f.split(':', 1)[1] for f in fams if f.startswith('freesound-user:')),
               'producerSpacePacks': sorted(f.split(':', 1)[1] for f in fams if f.startswith('producer-space:'))},
              open(f'{OUT}/reserved-test-families.json', 'w'), indent=1)
    sha = hashlib.sha256(open(manifest_path, 'rb').read()).hexdigest()
    json.dump({'frozenAt': now, 'manifestSha256': sha, 'counts': dict(stats), 'families': len(fams),
               **({'geminiModel': gem_model, 'geminiAgreementWithHumans': accept, 'geminiMinAgreement': GEMINI_MIN_AGREEMENT} if gem else {})},
              open(f'{OUT}/summary.json', 'w'), indent=1)
    print(json.dumps({'test': stats['test'], 'families': len(fams), 'manifestSha256': sha[:16]}), file=sys.stderr)
    print({k: v for k, v in stats.items() if k.startswith('role:bass hit')})


if __name__ == '__main__':
    {'select': select, 'freeze': freeze, 'agreement': agreement_report}[sys.argv[1]]()
