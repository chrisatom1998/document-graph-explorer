"""Run 9's staged audio (stage-run9.py) as tagger training windows, a held-out test, and code-built renders.

Usage: python3 scripts/audio-model/prepare-run9.py <staged-dir> <out-dir> [--workers 6] [--limit N]
         [--prefix et] [--lookalikes round12/round12.json] [--no-renders]
  Round 12: --prefix names the outputs <prefix>fs9 / <prefix>ls9 / eval-<prefix>run9 so a second staged set (the empty-tag
  audio) can be prepared beside run 9's; --lookalikes adds that JSON's 'lookalikes' groups; --no-renders skips the code renders.
  <staged-dir> holds one folder per staged part (freesound-0..k, labelled), each with manifest.csv and audio-NNN.tar.
  -> fs9-mel.npy + fs9.json          Freesound train rows (keyword, CED-confirmed and CED-mapped; all unreviewed)
  -> ls9-mel.npy + ls9.json          labelled-set train windows (ESC-50, Nonspeech7k, VIVAE, VocalSet, IRMAS, Groove MIDI,
                                     tabla, ChoirSet, VSCO 2 CE, licensed-pilot CC0 packs) plus renders of train clips
  -> eval-run9.npy + eval-run9.json  held-out rows and renders of held-out clips: test only, never trained, tuned or calibrated on
  -> run9-ids.json                   every id used, by output, for the data manifest

Labels: an item's own tags are present; the other run 9 tags are weak absences (uploaders and dataset labels are
selective), as in prepare-fsnew.py, stored compactly as weakAll='run9' (labels_extra.RUN9_TAGS; train.py expands it). One group in five (uploader, performer, recording; by hash) is validation, so
calibration has positives for the rare tags. The held-out test keeps at most HELD_PER_TAG positives per tag.

Renders (RENDERS below) are built from real train clips for training and from real held-out clips for the test, so a
render never crosses the split. They cover the tags the report says to build with code: reverse cymbal, reverse impact,
reversed vocal, vocal chops, pitched vocal, vocal pad, chorused, echoing, flanged, bitcrushed, saturated, stutter effect,
record stop, rising, filter sweep, and sub drop (synthesised outright).
"""
import argparse, csv, hashlib, importlib.util, json, os, random, sys, tarfile
from collections import Counter, defaultdict
from multiprocessing import Pool
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from labelmap import CAT  # noqa: E402
from labels_extra import EXTRA_CAT, RUN9_TAGS  # noqa: E402
import render  # noqa: E402
RATE, N = 32000, 320000
HELD_PER_TAG, RENDER_TRAIN, RENDER_HELD = 120, 400, 60
h = lambda *p: int(hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()[:8], 16)
VOICE = {'voice', 'spoken phrase', 'vocal phrase', 'vocal vowel'}
MUSIC = {'synthesizer', 'synth lead', 'electric piano', 'plucked', 'flute', 'clarinet', 'trumpet', 'cello', 'synth bass', 'atmospheric pad',
         'synth drone', 'acoustic guitar', 'electric guitar', 'bass guitar', 'drum loop', 'voice'}
# render tag -> (source tags, effect, extra labels, keep the source's own tags)
RENDERS = {
    'reverse cymbal': ({'crash cymbal', 'cymbal'}, 'reverse effect', ['reverse effect'], False),
    'reverse impact': ({'impact', 'foley hit'}, 'reverse effect', ['reverse effect'], False),
    'reversed vocal': (VOICE, 'reverse effect', ['reverse effect'], False),
    'vocal chops': (VOICE, 'chop', ['chops'], False),
    'pitched vocal': (VOICE, 'pitch', [], False),
    'vocal pad': ({'vocal vowel', 'voice', 'choir'}, 'pad', [], False),
    'chorused': (MUSIC, 'chorused', [], True),
    'echoing': (MUSIC, 'echoing', [], True),
    'flanged': (MUSIC, 'flanged', [], True),
    'bitcrushed': (MUSIC, 'bitcrushed', [], True),
    'saturated': (MUSIC, 'saturated', [], True),
    'stutter effect': (MUSIC, 'stutter effect', [], False),
    'record stop': (MUSIC, 'record stop', [], False),
    'rising': (MUSIC, 'rising', [], False),
    'filter sweep': (MUSIC | {'noise'}, 'sweep', ['filtered'], True),
    'sub drop': (None, 'subdrop', [], False),
}

def fx(name, x, seed):
    """render.apply plus the four edits render.py lacks (chop, pitch, pad, sweep) and a synthesised sub drop."""
    r = random.Random(seed); t = np.arange(N) / RATE
    if name == 'subdrop':
        f0, f1, dur, at = r.uniform(55, 120), r.uniform(20, 38), r.uniform(.6, 3.0), r.uniform(0, 5)
        tt = np.clip(t - at, 0, None); f = f1 + (f0 - f1) * np.exp(-tt / (dur / 3)); ph = 2 * np.pi * np.cumsum(f) / RATE
        env = (t >= at) * np.exp(-tt / dur) * np.minimum(1, tt / .01); y = np.sin(ph) * env
        if r.random() < .5: y = np.tanh(y * r.uniform(1.5, 4))
        if x is not None and r.random() < .5: y = y + x / (render.rms(x) + 1e-9) * render.rms(y) * r.uniform(.1, .3)   # under a quiet bed
        return (y / (np.abs(y).max() + 1e-9) * .9).astype(np.float32)
    if name == 'chop':
        sl = int(RATE * 60 / r.uniform(90, 170) / r.choice([2, 4])); act = np.flatnonzero(np.abs(x) > .05 * np.abs(x).max())
        if len(act) < sl * 2: return None
        starts = [int(s) for s in act[::sl] if s + sl <= len(x)][:64]
        if not starts: return None
        fade = np.minimum(1, np.minimum(np.arange(sl), np.arange(sl)[::-1]) / 64)
        pieces = [x[s:s + sl] * fade for s in r.sample(starts, min(8, len(starts)))]
        y, pos = np.zeros(N), 0
        while pos + sl < N:
            p = r.choice(pieces); y[pos:pos + sl] += p if r.random() < .8 else 0; pos += sl * r.choice([1, 1, 2])
        return render.apply('reverberant', y, seed) if r.random() < .2 else y.astype(np.float32)
    if name == 'pitch':
        y = render.warp(x.astype(np.float64), np.full(N, r.choice([-1, 1]) * r.uniform(4, 12)))
        return y.astype(np.float32) if render.rms(y) > .25 * render.rms(x) else None
    if name == 'pad':
        act = np.flatnonzero(np.abs(x) > .2 * np.abs(x).max())
        if not len(act): return None
        g = int(r.uniform(.08, .25) * RATE); ok = act[act + g <= len(x)]
        if not len(ok): return None
        s0 = int(r.choice(list(ok))); grain = x[s0:s0 + g] * np.hanning(g)
        y = np.zeros(N + g); hop = g // 4
        for k in range(0, N, hop): y[k:k + len(grain)] += grain * r.uniform(.7, 1.0)
        y = render.apply('reverberant', y[:N], seed)
        if y is None: return None
        from scipy.signal import butter, sosfilt
        return sosfilt(butter(2, r.uniform(2000, 5000), 'low', fs=RATE, output='sos'), y).astype(np.float32)
    if name == 'sweep':
        from scipy.signal import butter, sosfilt
        lo, hi, dur = r.uniform(150, 400), r.uniform(6000, 12000), r.uniform(2, 8); kind = r.choice(['low', 'high'])
        up = r.random() < .5; y, zi, B = np.zeros(N), None, 256
        for s in range(0, N, B):
            a = min(1.0, s / RATE / dur); a = a if up else 1 - a
            sos = butter(2, lo * (hi / lo) ** a, kind, fs=RATE, output='sos')
            if zi is None: zi = np.zeros((sos.shape[0], 2))
            y[s:s + B], zi = sosfilt(sos, x[s:s + B], zi=zi)
        return y.astype(np.float32) if render.rms(y) > .05 * render.rms(x) else None
    y = render.apply(name, x, seed)
    return None if y is None else y.astype(np.float32)

_tars = {}
def read_member(staged, part, file):
    tarname, member = file.split('/', 1); key = (part, tarname)
    if key not in _tars: _tars[key] = tarfile.open(os.path.join(staged, part, tarname))
    return _tars[key].extractfile(member).read()

def work(job):
    staged, row, renders = job
    pe = work.pe
    x = pe.decode(read_member(staged, row['part'], row['file']))
    if x is None: return row, None, []
    out = []
    for tag, seed in renders:
        try: y = fx(RENDERS[tag][1], x.astype(np.float64), seed)
        except Exception as e: print(f'  render {tag} failed on {row["id"]}: {e}', flush=True); continue
        if y is not None and np.isfinite(y).all() and np.abs(y).max() > 1e-3: out.append((tag, np.clip(y, -1, 1).astype(np.float32)))
    return row, x, out

def init_worker():
    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(HERE, 'prepare-extra.py'))
    work.pe = importlib.util.module_from_spec(spec); spec.loader.exec_module(work.pe)

# Look-alike negatives (Chris 2026-10-10: shipped heads over-fire on sibling sounds, e.g. clarinet on oboe/flute, marimba on
# vibraphone): a Freesound train clip whose own tags name exactly one member of a group is an outright (full-weight) absence
# for the group's other members instead of a weak one. Parent/child pairs (hi-hat / closed hi-hat) are never in one group.
LOOKALIKES = [
    ['clarinet', 'oboe', 'flute', 'bassoon', 'saxophone'],
    ['marimba', 'vibraphone', 'xylophone', 'glockenspiel'],
    ['mandolin', 'banjo', 'acoustic guitar', 'sitar', 'harp'],
    ['viola', 'cello', 'double bass'],
    ['trumpet', 'trombone', 'tuba', 'horn'],
    ['tabla', 'bongo', 'conga', 'cajon'],
    ['closed hi-hat', 'open hi-hat', 'shaker', 'tambourine'],
]


def add_lookalikes(path):
    for g in json.load(open(path)).get('lookalikes', []):
        if g not in LOOKALIKES: LOOKALIKES.append(g)


def lookalike_absent(own):
    out = set()
    for g in LOOKALIKES:
        hit = set(own) & set(g)
        if len(hit) == 1: out |= set(g) - set(own)
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('staged'); ap.add_argument('out'); ap.add_argument('--workers', type=int, default=6); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--prefix', default=''); ap.add_argument('--lookalikes', default=''); ap.add_argument('--no-renders', action='store_true')
    ap.add_argument('--audit', default='', help="run9-audit.py's manifest-audited.csv: keep only its keep=1 items, with its merged tags")
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    if args.lookalikes: add_lookalikes(args.lookalikes)
    P = args.prefix; FS, LS, EV = f'{P}fs9', f'{P}ls9', f'eval-{P}run9'
    rows = []
    for part in sorted(os.listdir(args.staged)):
        m = os.path.join(args.staged, part, 'manifest.csv')
        if os.path.exists(m): rows += [dict(r, part=part) for r in csv.DictReader(open(m))]
    if args.audit:   # duplicate audio, training copies of held-out audio and groups on both sides are dropped there
        aud = {(os.path.basename(a['part']), a['id']): a for a in csv.DictReader(open(args.audit))}
        before = len(rows)
        rows = [dict(r, tags=aud[r['part'], r['id']]['tags']) for r in rows if aud.get((r['part'], r['id']), {}).get('keep') == '1']
        print(f'run9: audit keeps {len(rows)} of {before} staged items', flush=True)
    if args.limit: rows = rows[::max(1, len(rows) // args.limit)]
    known = set(CAT) | set(EXTRA_CAT)
    for r in rows: r['own'] = sorted(set(r['tags'].split('|')) & known)
    missing = Counter(t for r in rows for t in set(r['tags'].split('|')) - known if t)
    if missing: print(f'run9: no output for {dict(missing)}; those labels are dropped', flush=True)
    T = sorted(set(RUN9_TAGS) | {t for r in rows for t in r['own']} | {l for v in RENDERS.values() for l in v[2]})
    T = [t for t in T if t in known]
    extra_weak = [t for t in T if t not in RUN9_TAGS]   # listed per item; RUN9_TAGS ride on weakAll='run9' (train.py)
    # held-out: at most HELD_PER_TAG positives per tag, spread over groups
    held = [r for r in rows if r['split'] == 'heldout' and r['own']]
    held.sort(key=lambda r: h('run9-held', r['id'])); cnt, per_group, keep = Counter(), Counter(), []
    for r in held:
        if any(cnt[t] < HELD_PER_TAG for t in r['own']) and per_group[r['group']] < 8:
            keep.append(r); per_group[r['group']] += 1; cnt.update(r['own'])
    train = [r for r in rows if r['split'] == 'train' and r['own']]
    # renders: pick source clips per render tag, deterministic, capped
    plan = defaultdict(list)
    for tag, (srcs, *_ ) in RENDERS.items():
        if tag not in known or args.no_renders: continue
        for side, pool, cap in (('train', train, RENDER_TRAIN), ('heldout', keep, RENDER_HELD)):
            cands = [r for r in pool if srcs is None or set(r['own']) & srcs]
            cands.sort(key=lambda r: h('run9-render', tag, r['id']))
            for r in cands[:cap]: plan[r['id']].append((tag, h('run9-seed', tag, r['id'])))
    print(f'run9: {len(train)} train items, {len(keep)} of {len(held)} held-out items kept; renders planned {sum(len(v) for v in plan.values())}', flush=True)

    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(HERE, 'prepare-extra.py'))
    pe = importlib.util.module_from_spec(spec); spec.loader.exec_module(pe)
    W = {'fs9': pe.Writer(args.out, FS, 1000), 'ls9': pe.Writer(args.out, LS, 1000)}
    ev_path = os.path.join(args.out, f'{EV}.raw'); ev = open(ev_path, 'wb'); ev_items = []
    ids = defaultdict(list); rcount = Counter()
    def add_train(name, it_id, group, own, x, source):
        lab = {f'cat:{l}': 1.0 for l in own}; lab.update({f'cat:{l}': 0.0 for l in extra_weak if l not in own})
        sure = lookalike_absent(own) if source == 'freesound' else set()
        W[name].add({'id': it_id, 'artist': group, 'val': h('dge-run9-val', group) % 5 == 0, 'labels': {**lab, **{f'cat:{l}': 0.0 for l in sure}},
                     'weakAll': 'run9', 'weakAbsent': [f'cat:{l}' for l in extra_weak if l not in own and l not in sure], 'source': source}, x)
        ids[{'fs9': FS, 'ls9': LS}[name]].append(it_id)
    def add_held(it_id, group, own, x, source):
        ev.write((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
        ev_items.append({'id': it_id, 'artist': group, 'source': source, 'labels': {f'cat:{l}': 'present' if l in own else 'absent' for l in T},
                         'weak': [f'cat:{l}' for l in T if l not in own]}); ids[EV].append(it_id)
    jobs = [(args.staged, r, plan.get(r['id'], [])) for r in train + keep]
    with Pool(args.workers, initializer=init_worker) as pool:
        for k, (r, x, rendered) in enumerate(pool.imap(work, jobs, chunksize=8)):
            if k % 5000 == 0: print(f'  run9 {k}/{len(jobs)}', flush=True)
            if x is None: continue
            name = 'fs9' if r['source'] == 'freesound' else 'ls9'
            if r['split'] == 'train': add_train(name, r['id'], r['group'], r['own'], x, r['source'])
            else: add_held(r['id'], r['group'], r['own'], x, r['source'])
            for tag, y in rendered:
                srcs, eff, extra, keep_own = RENDERS[tag]
                own = sorted(({tag} | set(extra) | (set(r['own']) if keep_own else set())) & known)
                rid = f"render:{tag.replace(' ', '-')}:{r['id']}"; rcount[tag, r['split']] += 1
                if r['split'] == 'train': add_train('ls9', rid, r['group'], own, y, 'render')
                else: add_held(rid, r['group'], own, y, 'render')
    for w, name in ((W['fs9'], 'freesound.org previews (CC0 / CC BY / CC BY-NC), run 9 keyword and CED-base checked rows; unreviewed; credit Freesound and its uploaders'),
                    (W['ls9'], 'run 9 labelled sets (ESC-50, Nonspeech7k, VIVAE, VocalSet, IRMAS, Groove MIDI, Four-Way Tabla, ChoirSet, VSCO 2 CE, licensed-pilot CC0) and code renders; unreviewed')):
        w.close(name)
    ev.close()
    json.dump({k: sorted(v) for k, v in ids.items()}, open(os.path.join(args.out, f'{P}run9-ids.json'), 'w'))
    if not ev_items:   # a train-only staged set (round 12's empty-tag audio) has no held-out rows
        os.remove(ev_path); print(f'{EV}: no held-out rows', flush=True); return
    src = np.memmap(ev_path, dtype=np.int16, mode='r', shape=(len(ev_items), N))
    dst = np.lib.format.open_memmap(os.path.join(args.out, f'{EV}.npy'), mode='w+', dtype=np.int16, shape=src.shape)
    for k in range(0, len(ev_items), 1024): dst[k:k + 1024] = src[k:k + 1024]
    dst.flush(); del dst, src; os.remove(ev_path)
    json.dump({'source': 'run 9 held-out rows (Freesound reserved uploaders, labelled-set held-out performers / recordings / folds) and renders of them; test only',
               'items': ev_items}, open(os.path.join(args.out, f'{EV}.json'), 'w'))
    pos = Counter(t for it in ev_items for c, v in it['labels'].items() if v == 'present' for t in [c[4:]])
    print(f'{EV}: {len(ev_items)} held-out clips from {len({i["artist"] for i in ev_items})} groups; positives ' + ', '.join(f'{t} {n}' for t, n in sorted(pos.items())), flush=True)
    print('renders (train/heldout): ' + ', '.join(f'{t} {rcount[t, "train"]}/{rcount[t, "heldout"]}' for t in sorted({t for t, _ in rcount})), flush=True)

if __name__ == '__main__':
    main()
