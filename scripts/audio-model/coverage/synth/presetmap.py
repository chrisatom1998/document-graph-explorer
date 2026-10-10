"""Coverage idea #5 (2026-10-10): map Surge XT factory and third-party presets to the app's synth tags.

  presetmap.py <out.csv> [--zenodo surge.json]

Each preset gets a role from its category folder (Basses -> bass, Pads -> pad, ...) and labels from the folder, its name
and a few measured facts about the patch (loaded with surgepy, the Surge XT Python bindings; build-surgepy.sh):
  - supersaw:  an audible saw oscillator with 5+ unison voices detuned 10+ cents, not filtered down to a near-sine (power
    spectral centroid of a held C4 200 Hz+), not an instrument imitation (or the name says supersaw)
  - reese bass: a sustained bass whose loudest saw oscillator has 2+ unison voices detuned 10+ cents (or the name says reese)
  - bass pluck: a bass whose held note falls under 12% of its attack level by 0.8-1.2 s (or the name says pluck)
  - wobble bass: name says wob/wub/dubstep AND a held note shows a 1.2-14 Hz filter/level wobble; render.py also makes
    LFO-rate automated wobble clips and keeps only those whose wobble is measured
Positives are set only where the folder or name is clear; ambiguous presets get no label for that tag (not a negative).
Negatives ("absent") are full-weight absences, set only where the role makes them safe (a bass played low is not a pad,
a pad played above C3 is not a bass, a patch with no detuned saw stack is not a supersaw). render.py adds a few more per
clip (e.g. a mono riff is not a synth chord). Presets in the Zenodo 4677097 Surge renders' validation split (prepare-extra.py)
are left out so the same patch never sits on both sides of that split.
"""
import argparse, csv, glob, hashlib, json, os, re, sys
import numpy as np

DATA = '/usr/local/share/surge-xt'
ROLE = {'Basses': 'bass', 'Bass': 'bass', 'Leads': 'lead', 'Pads': 'pad', 'Atmospheres': 'pad', 'Ambiance': 'pad', 'Plucks': 'pluck',
        'Brass': 'brass', 'Strings': 'strings', 'Chords': 'chords', 'Vox': 'vox', 'Voices': 'vox', 'Polysynths': 'poly', 'Synths': 'poly',
        'Keys': 'keys', 'Mallets': 'keys', 'Guitars': 'keys', 'Organs': 'organ', 'Bells': 'bell', 'Winds': 'winds', 'Sequences': 'seq', 'Arps': 'seq'}
SKIPPED = 'FX, Drums, Percussion, Rhythms, Soundscapes, Templates, Splits, MPE, Tutorials, Vocoder, Audio In, Formula Modulator, Modelled, Drones'
BASS_FAM = ['synth bass', '808 bass', 'reese bass', 'acid bass', 'wobble bass', 'bass pluck']
SUBTYPES = ['reese bass', 'acid bass', '808 bass']   # one named -> the others are absent (round 12 look-alike group spirit)
TARGETS = ['supersaw', 'string synth', 'brass synth', 'bass pluck', 'reese bass', 'acid bass', '808 bass', 'synth pluck', 'synth lead',
           'synth chord', 'atmospheric pad', 'vocal-like synth', 'wobble bass']

def rx(p, s): return re.search(p, s) is not None
N_SUPERSAW = r'super ?saws?|hyper ?saw|jp ?8k|saw swarm'
N_REESE = r'\brees(e|es|ey)\b'
N_ACID = r'\bacid|\b303\b'
N_808 = r'808'
N_WOB = r'\bwob|\bwub|dubstep'
N_PLUCK = r'pluck|\bplk\b|plonk|pizz|staccato|\bshort\b'
N_VOX = r'\bvox\b|vocal|\bvoices?\b|choir|formant|\btalk|vowel|\bo-?ah\b|munchkin|gregorian'
N_VOX_NOT = r'one voice|breath|whisper'
N_STRING = r'strings?\b|string machine|ensemble|solina'
N_STRING_REAL = (r'solo|violin|viola|cello|contrabass|quartet|pizz|pluck|strum|hammered|dulcimer|santoor|psaltery|clavichord|piano|'
                 r'erhu|hurdy|trombone|tradition|comb|stringed|bowed|bass')
N_BRASS = r'brass'
N_BRASS_REAL = r'trumpet|horn|tuba|trombone|sax'
N_BASSWORD = r'bass|\bsub\b|808|rees|wob|\blow\b|hoover'
N_ROLEWORDS = r'\bpad|pluck|\blead|\bbass|808|chord|\bseq|\barp|drone|stab'
N_ORGAN = r'organ|drawbar|\bb3\b|hammond'
N_BELL = r'\bbells?\b|chime'

def zenodo_key(rel):
    parts = rel[:-4].split('/')
    if parts[0] == 'patches_factory': bits = ['factory'] + parts[1:]
    else: bits = ['3rdparty'] + parts[1:]
    return 'surge-patches-' + '-'.join(b.replace(' ', '-') for b in bits) + '-velocity64'

def disp(s, p): return s.getParamDisplay(p)
def num(t):
    m = re.search(r'-?\d+(\.\d+)?', t); return float(m.group()) if m else 0.0

def osc_facts(s):
    """Active oscillators of the playing scene(s): type, saw-ness, unison voices and detune, level in dB."""
    P = s.getPatch(); mode = disp(s, P['scenemode']); scenes = [int(num(disp(s, P['scene_active'])))] if mode == 'Single' else [0, 1]
    out = []
    for sc in scenes:
        S = P['scene'][sc]
        for i, o in enumerate(S['osc']):
            if disp(s, S[f'mute_o{i+1}']) == 'On': continue
            lvl = disp(s, S[f'level_o{i+1}']); db = -96.0 if 'inf' in lvl.lower() else num(lvl)
            if db < -40: continue
            typ = disp(s, o['type']); ps = {p.getName().split(f'Osc {i+1} ', 1)[-1]: p for p in o['p']}
            uv = int(num(disp(s, ps['Unison Voices']))) if 'Unison Voices' in ps else 1
            ud = num(disp(s, ps['Unison Detune'])) if 'Unison Detune' in ps else 0.0
            if typ == 'Classic': saw = s.getParamVal(ps['Shape']) >= -0.3
            elif typ == 'Modern': saw = num(disp(s, ps['Sawtooth'])) >= 50
            elif typ == 'Alias': saw = disp(s, ps['Shape']) in ('Ramp', 'Saw', 'Sawtooth')
            else: saw = None
            out.append({'scene': sc, 'osc': i, 'type': typ, 'saw': saw, 'voices': uv, 'detune': ud, 'db': db})
    return out

def lfo_cutoff_slots(s):
    """(scene, lfo index) of periodic LFOs that move a filter cutoff or a volume in the patch's own routing."""
    P = s.getPatch(); r = s.getAllModRoutings(); slots = set()
    for sc, R in enumerate(r['scene']):
        for k in ('scene', 'voice'):
            for m in R[k]:
                src, dst = m.getSource().getName(), m.getDest().getName()
                mm = re.match(r'(Voice|Scene) LFO (\d)', src)
                if not mm or not re.search(r'Cutoff|Volume', dst): continue
                idx = int(mm.group(2)) - 1 + (6 if mm.group(1) == 'Scene' else 0)
                if disp(s, P['scene'][sc]['lfo'][idx]['shape']) in ('Sine', 'Triangle', 'Square', 'Sawtooth'): slots.add((sc, idx))
    return sorted(slots)

def render_note(s, note, vel, hold, total, sr=48000):
    B = s.getBlockSize(); n1 = int(hold * sr / B); n2 = int((total - hold) * sr / B)
    s.playNote(0, note, vel, 0); a = s.createMultiBlock(n1); s.processMultiBlock(a)
    s.releaseNote(0, note, 0); b = s.createMultiBlock(max(n2, 1)); s.processMultiBlock(b)
    return np.concatenate([a, b], 1).mean(0)

def frames_rms(x, sr=48000, hop=0.01):
    h = int(sr * hop); n = len(x) // h
    return np.sqrt((x[:n * h].reshape(n, h) ** 2).mean(1) + 1e-12)

def wobble_strength(x, sr=48000, t0=0.3, lo=1.2, hi=14.0):
    """Share of the 0.2-50 Hz modulation energy of the level and brightness tracks that sits in the strongest lo-hi Hz peak."""
    from scipy.signal import stft
    hop = int(sr * 0.01); f, t, S = stft(x, sr, nperseg=2048, noverlap=2048 - hop); S = np.abs(S) + 1e-9
    best = (0.0, 0.0)
    for tr in ((f[:, None] * S).sum(0) / S.sum(0), np.log(S.sum(0))):
        tr = tr[int(t0 / 0.01):]
        if len(tr) < 64: continue
        tr = (tr - tr.mean()) / (abs(tr.mean()) + 1e-9) if tr is not None else tr
        F = np.abs(np.fft.rfft((tr - tr.mean()) * np.hanning(len(tr)))); fr = np.fft.rfftfreq(len(tr), 0.01)
        band = (fr > lo) & (fr < hi); k = int(np.argmax(F[band])); share = float(F[band][k] / (F[fr > 0.2].sum() + 1e-9))
        if share > best[0]: best = (share, float(fr[band][k]))
    return best

def probe(s):
    """Held C2 (bass) / C4 (others) note facts: plucky ratio (late level / attack level) and wobble strength."""
    x = render_note(s, 36, 100, 2.0, 2.5)
    e = frames_rms(x); pk = e[:30].max() + 1e-9; late = e[80:120].mean()
    ws, wf = wobble_strength(x[:int(2.0 * 48000)])
    s.allNotesOff(); y = render_note(s, 60, 100, 1.6, 1.6)[int(0.3 * 48000):]
    Y = np.abs(np.fft.rfft(y * np.hanning(len(y)))) ** 2; f = np.fft.rfftfreq(len(y), 1 / 48000)
    cent = float((f * Y).sum() / (Y.sum() + 1e-12))
    return {'peak': float(pk), 'late_ratio': float(late / pk), 'wob_share': ws, 'wob_hz': wf, 'centroid_c4': cent,
            'silent': bool(np.abs(x).max() < 1e-4 and np.abs(y).max() < 1e-4)}

def label(rel, s):
    parts = rel[:-4].split('/'); author = parts[1] if parts[0] == 'patches_3rdparty' else 'Surge factory'
    cat, name = parts[-2], parts[-1]; n = name.lower(); role = ROLE.get(cat)
    row = {'preset': rel, 'author': author, 'category': cat, 'name': name, 'role': role or '', 'positives': '', 'negatives': '',
           'reason': '', 'excluded': ''}
    if role is None: row['excluded'] = f'category {cat} not rendered (skipped: {SKIPPED})'; return row, None
    s.loadPatch(f'{DATA}/{rel}'); oscs = osc_facts(s); pr = probe(s); s.loadPatch(f'{DATA}/{rel}')
    slots = lfo_cutoff_slots(s)
    if pr['silent']: row['excluded'] = 'held note renders silent (needs audio input or a controller)'; return row, None
    pos, neg, why = set(), set(), []
    def P(t, r): pos.add(t); why.append(f'+{t}: {r}')
    def N(t, r):
        if t not in pos: neg.add(t); why.append(f'-{t}: {r}')
    loud = max((o['db'] for o in oscs), default=-96)
    sawstack = [o for o in oscs if o['saw'] and o['voices'] >= 5 and o['detune'] >= 10 and o['db'] >= loud - 6]
    imitation = rx(r'organ|flute|bell|tuba|cello|piano|guitar|violin|horn|trumpet|clarinet|oboe|sax|choir|voice|vox|kalimba|marimba', n)
    bright = pr['centroid_c4'] >= 200   # power-weighted centroid: only rules out a near-sine, fully filtered stack
    any_unison = any(o['voices'] >= 3 for o in oscs); n_saw = sum(1 for o in oscs if o['saw'])
    unknown_osc = any(o['saw'] is None for o in oscs)
    vox = rx(N_VOX, n) and not rx(N_VOX_NOT, n)
    if role == 'bass':
        P('synth bass', f'category {cat}')
        named = [t for t, p in (('reese bass', N_REESE), ('acid bass', N_ACID), ('808 bass', N_808)) if rx(p, n)]
        if 'hoover' in n: why.append('hoover: reese-like but not clearly reese, no bass subtype label')
        for t in named: P(t, 'name')
        if 'acid bass' in pos: P('acid synth', 'name (acid bass is shown as acid synth, #215)')
        plucky = pr['late_ratio'] < 0.12
        if rx(r'guitar|finger|string bass|slap|picked', n): why.append('bass guitar / string bass imitation: no bass pluck label')
        elif rx(N_PLUCK, n): P('bass pluck', 'name')
        elif plucky and not named: P('bass pluck', f"held note falls to {pr['late_ratio']:.0%} of its attack by 1 s")
        detuned = [o for o in oscs if o['saw'] and o['voices'] >= 2 and o['detune'] >= 10 and o['db'] >= loud - 3]
        if not named and 'hoover' not in n and not plucky and detuned and not rx(r'fm|sub|moog|fifth|guitar|speaking|vowel|talk|string', n):
            P('reese bass', f"sustained bass, loudest saw has {detuned[0]['voices']} unison voices at {detuned[0]['detune']:.0f} cents")
        sub = [t for t in SUBTYPES if t in pos]
        if len(sub) == 1:
            for t in SUBTYPES:
                if t != sub[0]: N(t, f'named/measured {sub[0]}')
        if rx(N_WOB, n):
            if pr['wob_share'] >= 0.06: P('wobble bass', f"name, and a held note wobbles at {pr['wob_hz']:.1f} Hz")
            else: why.append('name says wobble but a held note does not wobble (needs mod wheel): no label')
        for t in ('atmospheric pad', 'string synth', 'brass synth', 'synth lead'): N(t, 'bass patch played below C4')
        if not vox: N('vocal-like synth', 'bass patch, name not vocal')
        if not (sawstack or any_unison or n_saw > 2 or unknown_osc): N('supersaw', 'no detuned saw stack in the patch')
    else:
        lowword = rx(N_BASSWORD, n)
        if not lowword:
            for t in BASS_FAM: N(t, f'{role} patch played from C3 up, name has no bass word')
        if role == 'lead':
            if rx(N_ROLEWORDS.replace(r'|\blead', ''), n): why.append('lead folder but the name names another role: no synth lead label')
            else: P('synth lead', f'category {cat}')
        if role == 'pad':
            if rx(N_STRING, n) or rx(N_BRASS, n) or vox or rx(N_ROLEWORDS.replace(r'\bpad|', ''), n):
                why.append('pad folder but the name names a more specific sound: no atmospheric pad label')
            else: P('atmospheric pad', f'category {cat} (the app\'s pad tag)')
            if not rx(N_PLUCK, n): N('synth pluck', 'pad patch')
            if not rx(r'\blead', n): N('synth lead', 'pad patch played as chords and long notes')
        if role == 'pluck':
            if rx(r'bass|\bpad|\blead', n): why.append('pluck folder but the name names another role: no synth pluck label')
            else: P('synth pluck', f'category {cat}')
            if not rx(r'\bpad|swell', n): N('atmospheric pad', 'short plucked patch')
        if role == 'brass':
            if rx(N_BRASS_REAL, n) and not rx(r'synth|brass|analog|fm', n) or rx(r'^fm horn$|soft fm horn|sax', n):
                why.append('brass folder but a realistic instrument imitation: no brass synth label')
            else: P('brass synth', f'category {cat}')
        if role == 'strings':
            if rx(N_STRING_REAL, n): why.append('strings folder but a realistic or plucked/struck instrument: no string synth label')
            else: P('string synth', f'category {cat}')
        if role == 'chords': P('synth chord', f'category {cat}: one key plays a chord')
        if role == 'vox':
            if rx(N_VOX_NOT, n): why.append('breath/whisper patch: no vocal-like synth label')
            else: P('vocal-like synth', f'category {cat}')
        if role == 'organ' or rx(N_ORGAN, n): P('organ synth', 'category/name organ')
        if role == 'bell' or rx(N_BELL, n) and role in ('keys', 'bell', 'poly'): P('bell synth', 'category/name bell')
        if role == 'seq':
            P('synth sequence', f'category {cat}: holding a key plays a pattern')
        if rx(N_ACID, n): P('acid synth', 'name')
        if role not in ('strings', 'pluck') and rx(N_STRING, n) and not rx(N_STRING_REAL, n) and not rx(N_BRASS, n): P('string synth', 'name')
        if role not in ('brass',) and rx(N_BRASS, n) and role != 'pluck': P('brass synth', 'name')
        if role != 'vox' and vox: P('vocal-like synth', 'name')
        if role in ('pad', 'strings', 'brass', 'organ', 'bell', 'keys', 'winds', 'vox', 'chords', 'poly'):
            if not rx(N_PLUCK, n) and role not in ('keys', 'bell', 'chords', 'poly'): N('synth pluck', f'{role} patch')
        if role in ('organ', 'bell', 'keys', 'winds', 'strings', 'brass', 'vox'):
            if not rx(r'\bpad', n): N('atmospheric pad', f'{role} patch')
            for t, p in (('string synth', N_STRING), ('brass synth', N_BRASS)):
                if not rx(p, n) and role not in ('strings', 'brass'): N(t, f'{role} patch, name not {t.split()[0]}')
            if role in ('organ', 'bell', 'keys', 'winds') and not vox: N('vocal-like synth', f'{role} patch, name not vocal')
        if role == 'strings' and not rx(N_BRASS, n): N('brass synth', 'strings patch')
        if role == 'brass' and not rx(N_STRING, n): N('string synth', 'brass patch')
        if rx(N_SUPERSAW, n): P('supersaw', 'name')
        elif sawstack and bright and not imitation and role in ('lead', 'pad', 'poly', 'pluck', 'chords', 'brass', 'strings', 'seq'):
            o = sawstack[0]; P('supersaw', f"saw oscillator with {o['voices']} unison voices at {o['detune']:.0f} cents, C4 note centroid {pr['centroid_c4']:.0f} Hz")
        elif sawstack: why.append('detuned saw stack but filtered to a near-sine or an instrument imitation: no supersaw label')
        elif not (any_unison or n_saw > 2 or unknown_osc): N('supersaw', 'no detuned saw stack in the patch')
    row.update(positives='|'.join(sorted(pos)), negatives='|'.join(sorted(neg - pos)), reason='; '.join(why))
    facts = {'oscs': oscs, 'probe': pr, 'lfo_slots': slots}
    return row, facts

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--zenodo', default='')
    ap.add_argument('--facts', default='', help='also write the measured facts per preset (json)')
    a = ap.parse_args()
    import surgepy
    s = surgepy.createSurge(48000)
    val = set()
    if a.zenodo:
        d = json.load(open(a.zenodo)); val = {i['artist'].removeprefix('surge:') for i in d['items'] if i['val']}
        allz = {i['artist'].removeprefix('surge:') for i in d['items']}
    rels = sorted(os.path.relpath(p, DATA) for p in glob.glob(f'{DATA}/patches_*/**/*.fxp', recursive=True))
    rows, facts, hit = [], {}, 0
    for k, rel in enumerate(rels):
        zk = zenodo_key(rel)
        if a.zenodo and zk in allz: hit += 1
        if zk in val:
            parts = rel[:-4].split('/')
            rows.append({'preset': rel, 'author': parts[1] if parts[0] == 'patches_3rdparty' else 'Surge factory', 'category': parts[-2],
                         'name': parts[-1], 'role': '', 'positives': '', 'negatives': '', 'reason': '',
                         'excluded': 'in the validation split of the Zenodo 4677097 Surge renders already in training', 'zenodo_key': zk}); continue
        try: row, f = label(rel, s)
        except Exception as e: row, f = {'preset': rel, 'excluded': f'load/probe failed: {e}'}, None
        row['zenodo_key'] = zk if zk in (allz if a.zenodo else set()) else ''
        rows.append(row)
        if f: facts[rel] = f
        if k % 200 == 0: print(f'  {k}/{len(rels)}', flush=True)
    cols = ['preset', 'author', 'category', 'name', 'role', 'positives', 'negatives', 'reason', 'excluded', 'zenodo_key']
    with open(a.out, 'w', newline='') as fh:
        w = csv.DictWriter(fh, cols, extrasaction='ignore'); w.writeheader(); [w.writerow({c: r.get(c, '') for c in cols}) for r in rows]
    if a.facts: json.dump(facts, open(a.facts, 'w'))
    from collections import Counter
    c = Counter(t for r in rows if not r.get('excluded') for t in r['positives'].split('|') if t)
    print(f'{len(rows)} presets, {sum(1 for r in rows if not r.get("excluded"))} kept; zenodo names matched {hit}; positives per tag (presets):')
    for t in TARGETS: print(f'  {t}: {c[t]}')

if __name__ == '__main__':
    main()
