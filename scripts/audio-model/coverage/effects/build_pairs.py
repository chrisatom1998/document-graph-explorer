"""Render the dry/wet effect pairs from select_sources.py's plan and write them in the empty-tags/v1 layout.

Usage: python3 -I build_pairs.py <plan.csv> <src-dir> <rir-dir> <out-dir> [--workers 4] [--limit N]
  <src-dir>: the downloaded source tars (run9/v1/labelled/audio-NNN.tar, empty-tags/v1/<part>/audio-000.tar) and the
             commercial files under commercial-train/<path>.
  <rir-dir>: OpenSLR SLR28 RIRS_NOISES/real_rirs_isotropic_noises (rir_list + wavs; Apache 2.0).
  -> <out-dir>/<part>/manifest.csv + audio-NNN.tar + summary.json, one part per effect tag (e.g. reverberant/), so
     prepare-run9.py <out-dir> <prep> --prefix fx --no-renders reads it as-is.

Each plan row gives two clips with the same group (so they always land in the same train/validation split):
  dry  the clean source window, 16 kHz mono, <= 10 s, padded to the wet copy's length (so length is no clue)
  wet  the same window through the effect, loudness matched to the dry copy
Labels: `tags` = present. `absent_tags` = sure (full) absences, `weak_absent_tags` = weak ones; see DRY_STATUS.
prepare-run9.py today reads only `tags` (everything else becomes a weak absence); the two absence columns are for a
reader that wants full negatives on the dry copies.
"""
import argparse, csv, hashlib, io, json, os, random, re, subprocess, sys, tarfile
from collections import Counter, defaultdict
from multiprocessing import Pool
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import effects as E  # noqa: E402
from select_sources import EFFECT_TAGS  # noqa: E402
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from labelmap import CAT  # noqa: E402
from labels_extra import EXTRA_CAT  # noqa: E402
KNOWN = set(CAT) | set(EXTRA_CAT)
RATE = E.RATE
h = lambda *p: int(hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()[:12], 16)
PREFIX = 'coverage/effect-pairs/v1'

CLEAN_ACOUSTIC = {'vocalset', 'csd', 'philharmonia', 'vsco2', 'VSCO-2-CE', 'iowa', 'karoryfer', 'sass-e', 'tabla'}
RECORDED = CLEAN_ACOUSTIC | {'nsynth', 'gmd', 'esc50', 'nonspeech7k', 'bbc-sfx'}
TIME_EDITS = {'reverse effect', 'reversed vocal', 'record stop', 'stutter effect'}
RHYTHM = {'drum loop', 'breakbeat', 'percussion loop', 'hi-hat loop', 'synth arpeggio', 'rhythmic', 'syncopated', 'sustained', 'swelling',
          'falling', 'rising', 'percussive', 'rolling', 'pulsing'}
# effect tags a wet copy of one effect can plausibly also sound like: never a sure absence on that wet copy
NEAR = {'reverberant': {'echoing'}, 'echoing': {'reverberant'}, 'chorused': {'flanged'}, 'flanged': {'chorused', 'filter sweep'},
        'distorted': {'bitcrushed', 'filtered'}, 'bitcrushed': {'distorted', 'filtered'}, 'filtered': {'filter sweep'}, 'filter sweep': set(),
        'reverse effect': {'reverberant'}, 'reversed vocal': {'reverberant'}, 'record stop': {'filtered', 'filter sweep'}, 'stutter effect': set()}
ALSO = {'filter sweep': {'filtered'}, 'reversed vocal': {'reverse effect'}}   # wet copy also carries these as present


def dry_status(effect, source):
    """How sure we are that a clean source clip does NOT carry this effect: 'full' or 'weak'."""
    if effect in ('reverberant', 'echoing', 'filtered'): return 'weak'   # rooms, slap-back and EQ are in most recordings
    if effect in ('chorused', 'distorted'): return 'full' if source in CLEAN_ACOUSTIC else 'weak'
    return 'full' if source in RECORDED else 'weak'   # reverse, record stop, stutter, bitcrush, flange, filter sweep


def load_irs(d):
    irs = []
    for line in open(os.path.join(d, 'rir_list')):
        f = os.path.join(d, line.split()[-1].split('/')[-1]); x, sr = sf.read(f, always_2d=True); x = x[:, 0].astype(np.float64)
        if sr != RATE: x = resample_poly(x, RATE, sr)
        p = int(np.argmax(np.abs(x))); x = x[max(0, p - 16):]
        e = np.cumsum((x ** 2)[::-1])[::-1]; db = 10 * np.log10(e / (e[0] + 1e-12) + 1e-12)
        i5, i25 = int(np.argmax(db < -5)), int(np.argmax(db < -25)); rt = (i25 - i5) / RATE * 3 if i25 > i5 else 0
        if not .3 <= rt <= 4: continue
        x = x[:int(min(len(x), rt * 1.2 * RATE))]; x *= np.linspace(1, 0, len(x)) ** .5; x /= np.sqrt(np.sum(x ** 2))
        name = os.path.basename(f); db_name = 'AIR (Aachen)' if name.startswith('air_') else 'RWCP' if name.startswith('RWCP') else 'REVERB 2014' if name.startswith('RVB') else '?'
        irs.append(dict(name=name, db=db_name, rt60=round(rt, 2), ir=x))
    return irs


_tars = {}
def read_source(src, row):
    if row['origin'] == 'commercial-train':
        x, sr = sf.read(os.path.join(src, 'commercial-train', row['file']), always_2d=True)
    else:
        tarname, member = row['file'].split('/', 1); key = (row['part'], tarname)
        if key not in _tars: _tars[key] = tarfile.open(os.path.join(src, row['part'], tarname))
        # these FLACs were piped out of ffmpeg (no length in the header), which libsndfile rejects; decode with ffmpeg
        out = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1'],
                             input=_tars[key].extractfile(member).read(), capture_output=True, check=True).stdout
        return np.frombuffer(out, np.float32).astype(np.float64)
    x = x.mean(axis=1).astype(np.float64)
    if sr != RATE: x = resample_poly(x, RATE, sr)
    return x


def window(x, tag, r):
    a = np.abs(x); pk = a.max() + 1e-9; act = np.flatnonzero(a > .01 * pk)
    if not len(act): return None
    x = x[max(0, act[0] - int(.01 * RATE)):act[-1] + int(.05 * RATE)]
    room = {'reverberant': r.uniform(2.5, 7), 'echoing': r.uniform(2.5, 7)}.get(tag, r.uniform(4, 10))   # leave room for tails
    n = int(room * RATE)
    if len(x) > n:
        st = r.randint(0, min(len(x) - n, int(5 * RATE))) if tag not in ('reverse effect', 'reversed vocal') or r.random() < .5 else 0
        x = x[st:st + n].copy(); x[-160:] *= np.linspace(1, 0, 160); x[:32] *= np.linspace(0, 1, 32)
    return x if E.rms(x) > 1e-4 else None


def bpm_of(row):
    m = re.search(r'(\d{2,3})\s*bpm', row['file'], re.I)
    return float(m.group(1)) if m and 60 <= float(m.group(1)) <= 200 else None


def flac(y):
    b = io.BytesIO(); sf.write(b, np.clip(y, -1, 1).astype(np.float32), RATE, format='FLAC', subtype='PCM_16'); return b.getvalue()


def work(job):
    row, src = job; r = random.Random(h('fxpair-v1', row['effect'], row['id']))
    try: x = read_source(src, row)
    except Exception as e: return row, None, f'decode: {e}'
    x = window(x, row['effect'], r)
    if x is None or len(x) < .2 * RATE: return row, None, 'silent or too short'
    try: d, y, s = E.apply(row['effect'], x, r, work.irs, bpm_of(row) if row['effect'] == 'stutter effect' else None)
    except Exception as e: return row, None, f'effect: {e}'
    if d is None: return row, None, s
    pcm_d = (np.clip(d, -1, 1) * 32767).astype(np.int16); pcm_w = (np.clip(y, -1, 1) * 32767).astype(np.int16)
    if np.array_equal(pcm_d, pcm_w): return row, None, 'no change'
    return row, dict(dry=flac(d), wet=flac(y), dry_pcm=hashlib.sha256(pcm_d.tobytes()).hexdigest(), wet_pcm=hashlib.sha256(pcm_w.tobytes()).hexdigest(),
                     seconds=round(len(d) / RATE, 3), settings=s), None


def init(rir_dir):
    work.irs = load_irs(rir_dir)


def labels(row, role, settings):
    own = [t for t in row['tags'].split('|') if t in KNOWN]; eff = row['effect']; src = row['source']
    status = {t: dry_status(t, src) for t in EFFECT_TAGS}
    if role == 'dry': present = set(own)
    else:
        if eff in ('reverse effect',): present = set()
        elif eff == 'reversed vocal': present = {'voice'} & set(own) or {'voice'}
        elif eff in TIME_EDITS: present = set(own) - RHYTHM
        else: present = set(own)
        present |= {eff} | ALSO.get(eff, set())
        for t in NEAR.get(eff, ()): status[t] = 'weak'
        if 'ir' in settings or 'plus_room' in settings: status['reverberant'] = 'weak'
    full = sorted(t for t in EFFECT_TAGS if t not in present and status[t] == 'full')
    weak = sorted(t for t in EFFECT_TAGS if t not in present and status[t] == 'weak')
    return sorted(present & KNOWN), full, weak


COLS = ['id', 'url', 'creator', 'licence', 'licence_class', 'encoded_sha256', 'pcm_sha256', 'seconds', 'split', 'group', 'tags', 'label_evidence',
        'route', 'score', 'source', 'part', 'file', 'keep', 'drop_reason',
        'pair_id', 'role', 'effect', 'absent_tags', 'weak_absent_tags', 'effect_settings', 'ir_file', 'ir_source', 'ir_licence',
        'source_dataset', 'source_id', 'source_origin', 'source_file', 'source_tags']
IR_LICENCE = 'OpenSLR SLR28 RIRS_NOISES, Apache 2.0 (measured RIRs from the RWCP, REVERB 2014 and AIR databases)'


class TarWriter:
    def __init__(self, d, per=2500): self.d, self.per, self.k, self.n, self.t = d, per, -1, 0, None
    def add(self, name, data):
        if self.t is None or self.n >= self.per:
            if self.t: self.t.close()
            self.k += 1; self.n = 0; self.t = tarfile.open(os.path.join(self.d, f'audio-{self.k:03d}.tar'), 'w')
        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mtime = 0; self.t.addfile(ti, io.BytesIO(data)); self.n += 1
        return f'audio-{self.k:03d}.tar/{name}'
    def close(self):
        if self.t: self.t.close()


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('plan'); ap.add_argument('src'); ap.add_argument('rirs'); ap.add_argument('out')
    ap.add_argument('--workers', type=int, default=4); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args(); plan = list(csv.DictReader(open(a.plan)))
    if a.limit: plan = plan[::max(1, len(plan) // a.limit)]
    init(a.rirs); print(f'{len(work.irs)} measured IRs kept', flush=True)
    parts, writers, rows, fails = {}, {}, defaultdict(list), Counter()
    with Pool(a.workers, initializer=init, initargs=(a.rirs,)) as pool:
        for k, (row, res, err) in enumerate(pool.imap_unordered(work, [(r, a.src) for r in plan], chunksize=4)):
            if k % 500 == 0: print(f'  {k}/{len(plan)}', flush=True)
            if res is None: fails[row['effect'], (err or '?').split(':')[0]] += 1; continue
            part = row['effect'].replace(' ', '-')
            if part not in writers: os.makedirs(os.path.join(a.out, part), exist_ok=True); writers[part] = TarWriter(os.path.join(a.out, part))
            pid = 'fxpair:' + hashlib.sha256(('v1|' + row['effect'] + '|' + row['id']).encode()).hexdigest()[:16]
            for role in ('dry', 'wet'):
                data = res[role]; name = f"{pid.split(':')[1]}_{role}.flac"; f = writers[part].add(name, data)
                present, full, weak = labels(row, role, res['settings'])
                s = res['settings']; ir = s.get('ir') or s.get('plus_room') or ''
                rows[part].append({
                    'id': f'{pid}:{role}', 'url': row['url'], 'creator': row['creator'], 'licence': row['licence'],
                    'licence_class': 'open' if row['origin'] == 'private-train' and 'NC' not in row['licence'] else ('commercial' if row['origin'] == 'commercial-train' else 'nc'),
                    'encoded_sha256': hashlib.sha256(data).hexdigest(), 'pcm_sha256': res[f'{role}_pcm'], 'seconds': res['seconds'], 'split': 'train',
                    'group': row['group'], 'tags': '|'.join(present),
                    'label_evidence': (f"dry copy of a clean train clip ({row['source']}); effect tags absent by source rule" if role == 'dry' else
                                       f"code-applied {row['effect']} on the paired dry clip; settings in effect_settings; not listened"),
                    'route': 'effect-pair', 'score': '', 'source': 'fxpair', 'part': f'{PREFIX}/{part}', 'file': f, 'keep': '1', 'drop_reason': '',
                    'pair_id': pid, 'role': role, 'effect': row['effect'], 'absent_tags': '|'.join(full), 'weak_absent_tags': '|'.join(weak),
                    'effect_settings': json.dumps(s, sort_keys=True) if role == 'wet' else '', 'ir_file': ir if role == 'wet' else '',
                    'ir_source': (next((i['db'] for i in work.irs if i['name'] == ir), '') if ir and role == 'wet' else ''),
                    'ir_licence': IR_LICENCE if ir and role == 'wet' else '', 'source_dataset': row['source'], 'source_id': row['id'],
                    'source_origin': ('cmjatom/dge-commercial-train (private bucket)' if row['origin'] == 'commercial-train' else f"cmjatom/dge-private-train {row['part']}"),
                    'source_file': row['file'], 'source_tags': row['tags']})
    for w in writers.values(): w.close()
    for part, rr in rows.items():
        rr.sort(key=lambda x: x['file'])
        with open(os.path.join(a.out, part, 'manifest.csv'), 'w', newline='') as f:
            w = csv.DictWriter(f, COLS); w.writeheader(); w.writerows(rr)
        json.dump({'pairs': len(rr) // 2, 'clips': len(rr), 'hours': round(sum(float(x['seconds']) for x in rr) / 3600, 2),
                   'by_source': Counter(x['source_dataset'] for x in rr if x['role'] == 'dry'),
                   'failed': {k[1]: v for k, v in fails.items() if k[0].replace(' ', '-') == part}}, open(os.path.join(a.out, part, 'summary.json'), 'w'), indent=1)
    print('pairs per tag', {p: len(v) // 2 for p, v in sorted(rows.items())}); print('failed', dict(fails))


if __name__ == '__main__':
    main()
