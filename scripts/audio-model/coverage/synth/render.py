"""Coverage idea #5 (2026-10-10): render Surge XT presets into labelled 16 kHz mono training clips (<= 8 s).

  render.py <map.csv> <facts.json> <out-dir> [--shard i/n] [--limit N]

Reads presetmap.py's map (labels per preset) and facts (patch probes), plays varied material through each kept preset
headlessly with surgepy and writes <out-dir>/clips/<id>.flac plus <out-dir>/clips-<i>.jsonl (one line per clip: labels,
absences, notes played, measured wobble). pack.py dedupes, tars and writes the manifest.

Material per role (the preset's folder): single notes across the role's range (velocity 45-127, held 0.3-6 s), chords
(stabs and progressions for poly/pluck/brass/chord presets, long held chords for pads/strings/vox), mono riffs (bass and
lead lines, 90-150 BPM, accents, ties; acid presets get 16th-note lines with slides and a filter-cutoff sweep), arpeggios
for plucks, and wobble clips for basses: the preset's own LFO (if one moves the filter) or an unused voice LFO routed to
filter 1 cutoff, with its rate switched between tempo values half way through. A wobble clip is kept only when both
halves measure a level/brightness wobble near the set rate. Clip-level labels on top of the preset's:
  chord material from poly/pluck/brass/chord presets -> +synth chord; mono riffs and single notes from bass/lead presets
  -> synth chord absent; lead riffs -> atmospheric pad absent; a held bass note with no LFO and no measured wobble ->
  wobble bass absent; kept wobble clips -> +wobble bass.
"""
import argparse, csv, hashlib, io, json, math, os, random, re, sys
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from presetmap import DATA, TARGETS, wobble_strength   # noqa: E402

SR_SYNTH, SR = 48000, 16000
MAX_S = 8.0
TARGET_PER_TAG = 450      # clips aimed for per tag before dedupe / drops
HI = {'808 bass': 50}     # clips per preset cap where a tag has very few presets
HI_DEFAULT, LO_DEFAULT = 30, 3
RANGE = {'bass': (28, 52), 'lead': (57, 86), 'pad': (48, 74), 'pluck': (48, 84), 'brass': (50, 74), 'strings': (48, 74),
         'chords': (48, 70), 'vox': (52, 76), 'poly': (48, 74), 'keys': (48, 82), 'organ': (48, 76), 'bell': (55, 86),
         'winds': (55, 84), 'seq': (40, 62)}
MATERIAL = {'bass': ['note', 'riff', 'note', 'riff', 'glide', 'riff'], 'lead': ['riff', 'note', 'riff', 'riff', 'note'],
            'pad': ['chord_long', 'note_long', 'chord_long', 'chord_prog'], 'pluck': ['note', 'arp', 'chord_short', 'riff'],
            'brass': ['chord_short', 'chord_long', 'note', 'riff', 'chord_prog'], 'strings': ['chord_long', 'chord_prog', 'note_long'],
            'chords': ['note', 'riff', 'note_long'], 'vox': ['note', 'chord_long', 'riff'], 'poly': ['chord_short', 'chord_prog', 'note'],
            'keys': ['chord_short', 'note'], 'organ': ['chord_short', 'note'], 'bell': ['note', 'chord_short'], 'winds': ['note', 'riff'],
            'seq': ['note_seq']}
CHORD_TAG_ROLES = {'poly', 'pluck', 'brass', 'chords'}
SCALES = {'minor': [0, 2, 3, 5, 7, 8, 10], 'pent': [0, 3, 5, 7, 10], 'phryg': [0, 1, 3, 5, 7, 8, 10], 'dorian': [0, 2, 3, 5, 7, 9, 10],
          'major': [0, 2, 4, 5, 7, 9, 11]}
VOICINGS = [[0, 4, 7], [0, 3, 7], [0, 3, 7, 10], [0, 4, 7, 11], [0, 5, 7], [0, 3, 7, 14], [0, 7, 12, 16], [0, 4, 7, 14], [0, 3, 10, 15]]
WOB_RATES = {'1/2': 0.5, '1/4': 1, '1/4T': 1.5, '1/8': 2, '1/8T': 3, '1/16': 4}   # LFO cycles per beat

def h(*p): return hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
def nn(m): return f'{NOTE[m % 12]}{m // 12 - 1}'

# ---------- material: lists of (t_on, t_off, note, vel) plus automation (t, kind, value) ----------
def m_note(r, lo, hi, long=False, seq=False):
    n = r.randint(lo, hi); hold = r.uniform(2.5, 6.0) if long else r.uniform(3.0, 6.5) if seq else r.choice([r.uniform(0.3, 1.0), r.uniform(1.0, 3.5)])
    return [(0.02, 0.02 + hold, n, r.randint(45, 127))], f'note {nn(n)} held {hold:.1f}s'

def m_glide(r, lo, hi):
    a = r.randint(lo, hi - 7); b = a + r.choice([-5, -2, 3, 5, 7, 12]); b = min(max(b, lo), hi); v = r.randint(70, 127)
    t1 = r.uniform(0.6, 1.5); t2 = t1 + r.uniform(0.8, 2.0)
    return [(0.02, t1 + 0.05, a, v), (t1, t2, b, v)], f'legato {nn(a)}->{nn(b)}'

def m_chord(r, lo, hi, kind):
    ev = []; desc = []
    if kind == 'chord_long': n_ch, dur = r.choice([1, 1, 2]), r.uniform(2.5, 5.5)
    elif kind == 'chord_prog': n_ch, dur = r.randint(2, 4), r.uniform(0.5, 1.6)
    else: n_ch, dur = r.choice([1, 2, 3]), r.uniform(0.2, 0.9)
    t = 0.02; root = r.randint(lo, hi - 12); gap = r.uniform(0.0, 0.5) if kind != 'chord_long' else 0.1
    for k in range(n_ch):
        v = r.choice(VOICINGS); vel = r.randint(55, 127); notes = [root + i for i in v]
        if kind == 'chord_short' and r.random() < .5 and k > 0: notes = [x + r.choice([-2, 3, 5, -5]) for x in notes]
        for x in notes: ev.append((t, t + dur, x, max(1, min(127, vel + r.randint(-8, 8)))))
        desc.append('+'.join(nn(x) for x in notes)); t += dur + gap
        root = min(max(root + r.choice([-5, -3, 2, 5, 7, -7, 0]), lo), hi - 12)
        if t > MAX_S - 1.5: break
    return ev, f'{kind} ' + ' | '.join(desc)

def m_riff(r, lo, hi, acid=False, arp=False):
    bpm = r.uniform(115, 140) if acid else r.uniform(90, 150); step = 60 / bpm / (4 if (acid or arp or r.random() < .5) else 2)
    scale = SCALES[r.choice(['minor', 'pent', 'phryg'] if acid else list(SCALES))]; root = r.randint(lo, max(lo, hi - 12))
    n_steps = min(int((MAX_S - 1.5) / step), r.choice([16, 32]) if step < .15 else r.choice([8, 16]))
    ev, t, prev = [], 0.02, None
    chord = [root + i for i in r.choice(VOICINGS)] if arp else None
    pattern = [r.random() < (.8 if acid else .65) for _ in range(min(n_steps, 16))]
    for k in range(n_steps):
        if not pattern[k % len(pattern)]: prev = None; continue
        if arp: n = chord[k % len(chord)] + 12 * ((k // len(chord)) % 2)
        else:
            deg = r.choice(range(len(scale))) if r.random() < .6 or prev is None else (scale.index(prev[1]) if prev[1] in scale else 0)
            n = root + scale[deg] + 12 * (r.random() < (.25 if acid else .15)); prev = (k, scale[deg])
        gate = r.uniform(.3, .95); vel = r.choice([70, 90, 110, 127]) if acid else r.randint(55, 127)
        if acid and r.random() < .25: gate = 1.08   # slide: overlaps the next note so mono patches glide
        ev.append((t + k * step, t + k * step + step * gate, min(max(n, lo - 2), hi + 12), vel))
    auto = []
    if acid:   # classic acid tweak: sweep filter cutoff up and back down over the line
        span = n_steps * step; a, b = r.uniform(-0.4, -0.1), r.uniform(0.2, 0.6)
        for i in range(int(span / 0.05)):
            x = i * 0.05 / span; auto.append((0.02 + i * 0.05, 'cutoff_rel', a + (b - a) * math.sin(math.pi * x)))
    desc = ('acid ' if acid else 'arp ' if arp else 'riff ') + f'{bpm:.0f}bpm step {step*1000:.0f}ms: ' + ' '.join(nn(e[2]) for e in ev[:24])
    return ev, desc, auto

def m_wobble(r, lo, hi):
    bpm = r.uniform(130, 150); beat = 60 / bpm
    r1, r2 = r.sample(['1/4', '1/4T', '1/8', '1/8T', '1/16', '1/2'], 2)
    n = r.randint(lo, min(hi, 45)); seg = r.uniform(2.2, 3.5); vel = r.randint(90, 127)
    ev = [(0.02, 0.02 + 2 * seg, n, vel)]
    auto = [(0.0, 'lfo_rate', WOB_RATES[r1] / beat), (0.02 + seg, 'lfo_rate', WOB_RATES[r2] / beat)]
    return ev, f'wobble {nn(n)} {bpm:.0f}bpm LFO {r1} then {r2}', auto, (seg, WOB_RATES[r1] / beat, WOB_RATES[r2] / beat)

# ---------- rendering ----------
class Synth:
    def __init__(self):
        import surgepy
        self.sp = surgepy; self.s = surgepy.createSurge(SR_SYNTH); self.B = self.s.getBlockSize()

    def load(self, rel):
        self.s.loadPatch(f'{DATA}/{rel}'); self.P = self.s.getPatch()

    def scene_ids(self):
        mode = self.s.getParamDisplay(self.P['scenemode'])
        return [int(float(re.sub(r'[^\d.]', '', self.s.getParamDisplay(self.P['scene_active'])) or 0))] if mode == 'Single' else [0, 1]

    def setup_wobble(self, r, slot):
        """slot=None: route an unused voice LFO to filter 1 (or 2) cutoff. Returns the rate params to automate, or None."""
        s = self.s; rates = []
        for sc in self.scene_ids():
            S = self.P['scene'][sc]
            if slot is not None:
                if slot[0] == sc: rates.append(S['lfo'][slot[1]]['rate'])
                continue
            fu = next((f for f in S['filterunit'] if s.getParamDisplay(f['type']) != 'Off'), None)
            if fu is None: return None
            used = set()
            for R in s.getAllModRoutings()['scene'][sc].values():
                for m in R:
                    mm = re.match(r'Voice LFO (\d)', m.getSource().getName())
                    if mm: used.add(int(mm.group(1)) - 1)
            free = [i for i in range(6) if i not in used]
            if not free: return None
            i = free[0]; L = S['lfo'][i]
            s.setParamVal(L['shape'], r.choice([0, 0, 1, 3]))   # sine, sine, triangle, sawtooth
            s.setParamVal(L['magnitude'], 1.0)
            ms = s.getModSource(getattr(self.sp.constants, f'ms_lfo{i+1}'))
            if not s.isValidModulation(fu['cutoff'], ms): return None
            s.setModDepth01(fu['cutoff'], ms, r.uniform(0.25, 0.55), sc, 0)
            rates.append(L['rate'])
        for p in rates:   # tempo-synced rates read 1/8 etc.; only free-running Hz rates are automated
            s.setParamVal(p, 1.0)
            if not s.getParamDisplay(p).endswith('Hz'): return None
        return rates or None

    def render(self, events, auto, rate_params=None, tail=2.5):
        s, B = self.s, self.B
        cut = [(f['cutoff'], s.getParamVal(f['cutoff']), s.getParamMin(f['cutoff']), s.getParamMax(f['cutoff']))
               for sc in self.scene_ids() for f in self.P['scene'][sc]['filterunit']]
        acts = [(t0, 0, 'on', n, v) for t0, t1, n, v in events] + [(t1, 1, 'off', n, 0) for t0, t1, n, v in events]
        acts += [(t, 2, k, val, 0) for t, k, val in auto]
        acts.sort(key=lambda a: (a[0], a[1]))
        end = min(MAX_S, max(t1 for _, t1, _, _ in events) + tail)
        out, now = [], 0.0
        for t, _, kind, a, b in acts + [(end, 9, 'end', 0, 0)]:
            t = min(t, end); nb = int(round((t - now) * SR_SYNTH / B))
            if nb > 0:
                buf = s.createMultiBlock(nb); s.processMultiBlock(buf); out.append(buf); now += nb * B / SR_SYNTH
            if kind == 'on': s.playNote(0, int(a), int(b), 0)
            elif kind == 'off': s.releaseNote(0, int(a), 0)
            elif kind == 'lfo_rate':
                for p in rate_params or []: s.setParamVal(p, float(np.clip(math.log2(a), s.getParamMin(p), s.getParamMax(p))))
            elif kind == 'cutoff_rel':
                for p, v0, lo, hi in cut: s.setParamVal(p, float(np.clip(v0 + a * (hi - lo), lo, hi)))
            if kind == 'end': break
        s.allNotesOff()
        return np.concatenate(out, 1) if out else np.zeros((2, 0), np.float32)

def finish(st, r):
    """stereo 48 kHz -> mono 16 kHz, trimmed, peak-normalised to -1..-10 dBFS; None if unusable."""
    if st.shape[1] == 0 or not np.isfinite(st).all(): return None
    mono = st.mean(0)
    if np.sqrt((mono ** 2).mean()) < 0.3 * np.sqrt((st[0] ** 2).mean() + 1e-12): mono = st[0]   # phase-cancelled stereo
    y = resample_poly(mono.astype(np.float64), 1, 3)
    pk = np.abs(y).max()
    if pk < 1e-4: return None
    hop = 160; env = np.sqrt(np.convolve(y ** 2, np.ones(hop) / hop, 'same'))
    loud = np.where(env > pk * 10 ** (-60 / 20))[0]
    if len(loud) == 0: return None
    y = y[:min(len(y), loud[-1] + int(0.05 * SR), int(MAX_S * SR))]
    if len(y) < int(0.25 * SR): return None
    y = y / np.abs(y).max() * 10 ** (-r.uniform(1, 10) / 20)
    return y.astype(np.float32)

def wob_ok(st, seg, f1, f2):
    x = st.mean(0); a = x[:int(seg * SR_SYNTH)]; b = x[int(seg * SR_SYNTH):int(2 * seg * SR_SYNTH)]
    res = []
    for y, f in ((a, f1), (b, f2)):
        share, hz = wobble_strength(y, lo=0.8, hi=16)
        near = any(abs(hz - f * m) <= 0.25 * f * m for m in (0.5, 1, 2))
        res.append((share, hz, share >= 0.05 and near))
    return all(ok for _, _, ok in res), res

def plan_counts(rows):
    from collections import Counter
    c = Counter(t for r in rows for t in r['positives'].split('|') if t in TARGETS)
    out = {}
    for r in rows:
        tg = [t for t in r['positives'].split('|') if t in TARGETS]
        if not tg: out[r['preset']] = 2; continue
        t = min(tg, key=lambda t: c[t])
        out[r['preset']] = int(min(HI.get(t, HI_DEFAULT), max(LO_DEFAULT, math.ceil(TARGET_PER_TAG / c[t]))))
    return out, c

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('map'); ap.add_argument('facts'); ap.add_argument('out')
    ap.add_argument('--shard', default='0/1'); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args(); si, sn = map(int, a.shard.split('/'))
    rows = [r for r in csv.DictReader(open(a.map)) if not r['excluded']]
    facts = json.load(open(a.facts)); counts, _ = plan_counts(rows)
    bass_rows = [r for r in rows if r['role'] == 'bass']
    os.makedirs(f'{a.out}/clips', exist_ok=True)
    mine = [r for k, r in enumerate(rows) if k % sn == si]
    if a.limit: mine = mine[:a.limit]
    log = open(f'{a.out}/clips-{si}.jsonl', 'a'); done = set()
    if os.path.exists(f'{a.out}/done-{si}.txt'): done = set(open(f'{a.out}/done-{si}.txt').read().split('\n'))
    dl = open(f'{a.out}/done-{si}.txt', 'a')
    syn = Synth()
    for pi, row in enumerate(mine):
        rel = row['preset']
        if rel in done: continue
        r = random.Random(h('dge-synth-render', rel)); role = row['role']; lo, hi = RANGE[role]
        pos = set(t for t in row['positives'].split('|') if t); neg = set(t for t in row['negatives'].split('|') if t)
        f = facts.get(rel, {}); slots = [tuple(x) for x in f.get('lfo_slots', [])]; pr = f.get('probe', {})
        n = counts[rel]; mats = MATERIAL[role]
        plan = [mats[k % len(mats)] for k in range(n)]
        acid = 'acid synth' in pos or 'acid bass' in pos
        if acid and role in ('bass', 'lead', 'pluck'): plan = [('acid' if k % 2 else m) for k, m in enumerate(plan)]
        if '808 bass' in pos: plan = [['note', 'glide', 'note', 'riff'][k % 4] for k in range(n)]; lo, hi = 24, 45
        if 'wobble bass' in pos and slots: plan = [('wobble_own' if k % 2 == 0 else m) for k, m in enumerate(plan)]
        subtype = pos & {'acid bass', '808 bass', 'reese bass', 'bass pluck'}
        if role == 'bass' and not subtype and pr.get('late_ratio', 0) >= 0.3:
            plan += ['wobble_add'] * (2 if len(bass_rows) > 250 else 3)   # ~600 attempts over all basses
        for k, mat in enumerate(plan):
            cr = random.Random(h('dge-synth-clip', rel, k))
            try:
                syn.load(rel); auto, rate_params, wob = [], None, None
                if mat in ('note', 'note_long', 'note_seq'): ev, desc = m_note(cr, lo, hi, long=mat == 'note_long', seq=mat == 'note_seq')
                elif mat == 'glide': ev, desc = m_glide(cr, lo, hi)
                elif mat.startswith('chord'): ev, desc = m_chord(cr, lo, hi, mat)
                elif mat in ('riff', 'acid', 'arp'): ev, desc, auto = m_riff(cr, lo, hi, acid=mat == 'acid', arp=mat == 'arp')
                elif mat.startswith('wobble'):
                    slot = (slots[0] if slots else None) if mat == 'wobble_own' else None
                    if mat == 'wobble_own' and slot is None: continue
                    rate_params = syn.setup_wobble(cr, slot)
                    if not rate_params and mat == 'wobble_own': syn.load(rel); rate_params = syn.setup_wobble(cr, None)
                    if not rate_params: continue
                    ev, desc, auto, wob = m_wobble(cr, lo, hi)
                st = syn.render(ev, auto, rate_params, tail=1.0 if mat.startswith('wobble') else 2.5)
                wres = None
                if wob:
                    ok, wres = wob_ok(st, *wob)
                    if not ok: continue
                y = finish(st, cr)
                if y is None: continue
                cpos, cneg = set(pos), set(neg)
                if mat.startswith('chord') and role in CHORD_TAG_ROLES: cpos.add('synth chord')
                if role in ('bass', 'lead') and mat in ('note', 'note_long', 'riff', 'acid', 'glide'): cneg.add('synth chord')
                if role == 'lead' and mat == 'riff': cneg.add('atmospheric pad')
                if role == 'bass' and mat in ('note', 'glide') and not slots and pr.get('wob_share', 1) < 0.03 and 'wobble bass' not in pos:
                    cneg.add('wobble bass')
                if mat in ('riff', 'acid', 'arp'): cpos.discard('wobble bass')   # short riff notes hide a preset's slow wobble
                if mat.startswith('wobble'): cpos.add('wobble bass'); cneg.discard('wobble bass')
                cneg -= cpos
                cid = f"synthpreset:{slug(rel.removeprefix('patches_').removesuffix('.fxp'))}@{k:02d}-{mat}"
                fn = slug(cid.replace(':', '_')) + '.flac'
                sf.write(f'{a.out}/clips/{fn}', y, SR, format='FLAC', subtype='PCM_16')
                log.write(json.dumps({'id': cid, 'file': fn, 'preset': rel, 'author': row['author'], 'category': row['category'],
                                      'name': row['name'], 'role': role, 'material': mat, 'notes': desc, 'seconds': round(len(y) / SR, 3),
                                      'tags': sorted(cpos | {'synthesizer'}), 'absent': sorted(cneg),
                                      'wobble': [[round(s_, 3), round(z, 2)] for s_, z, _ in wres] if wres else None,
                                      'events': [[round(t0, 3), round(t1, 3), nn_, v] for t0, t1, nn_, v in ev][:64]}) + '\n')
            except Exception as e:
                print(f'  {rel} clip {k} {mat}: {e}', flush=True)
        log.flush(); dl.write(rel + '\n'); dl.flush()
        if pi % 50 == 0: print(f'shard {si}: {pi}/{len(mine)} presets', flush=True)
    print(f'shard {si}: done', flush=True)

if __name__ == '__main__':
    main()
