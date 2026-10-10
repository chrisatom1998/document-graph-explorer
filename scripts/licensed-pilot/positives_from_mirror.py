"""Round two: real recorded bass guitar and foley hit clips (and hard negatives) from the Freesound LAION-640k mirror.

Usage:
  python3 -I scripts/licensed-pilot/positives_from_mirror.py select <ced run dir> <exclusion-manifest.json> \
      <run 7 candidates.csv> <run 9 keyword.csv> <out-dir> [<kind> [<plan.csv to skip>]]
  python3 -I scripts/licensed-pilot/positives_from_mirror.py fetch <out-dir> [<workers>]

<ced run dir>: runs/ced-freesound-38026076860-1 of the private HF dataset cmjatom/dge-eval-runs (CED-base AudioSet
probabilities of the first 10 s of every mirror clip, one npz per mirror shard, plus labels.txt and candidates.csv).
select needs no network: it picks clips by CED score, applies every exclusion and writes <out-dir>/plan.csv. Each clip
gets the first kind it qualifies for, in the order bass guitar, foley hit, hard negative, drum negative. With <kind>
the plan keeps only that kind, minus any id already in <plan.csv to skip>. Round two ran select three times: once
with no kind (out-dir pos), then "hard negative" skipping pos/plan.csv, then "drum negative". With this script the
first plan's bass guitar and foley hit rows and the other two plans reproduce exactly. The first run predates the final
low-sound class list and hard-negative cap: its 15 hard negatives (13 kept, in the project manifest) and its
select-summary counts do not reproduce.
fetch reads only the parquet row groups that hold planned clips, over HTTP range requests (no shard is stored), keeps
the first 10 s as mono 48 kHz wav, checks the uploader's own text, and writes <out-dir>/positives.csv.

Labels need two independent signals, and nothing was reviewed by ear ("auto-checked (not listened)"):
- bass guitar = 1: CED "Bass guitar" >= 0.3 AND the uploader's title/tags name a bass, and none names a double bass,
  synth or 808 bass. Hard negatives (bass guitar = 0): CED "Bass guitar" < 0.1 and one of OTHER_CLASSES >= 0.6, and the
  text names such a sound (synth or 808 bass, kick, double bass, guitar...) and no bass guitar. Drum negatives
  (bass guitar = 0): a CED drum class >= 0.6 with CED "Bass guitar" < 0.05, and the text names drums or a beat and no bass.
- foley hit = 1: the best CED impact class (IMPACT below, or the run's own foley hit shortlist) >= 0.5 AND the text names an impact or foley, and none names
  a drum, music or loop.
Licence: CC0, CC BY 4.0 or CC BY 3.0 only (mirror codes 0-2), so trained weights carry no non-commercial term.
Exclusions: the DGE exclusion manifest's held-out and reserved Freesound ids and uploaders (its "prior" sets only mark
material that is not new, and round two may reuse it), the three dynamic held-out uploader rules, run 7's held-out rows and run 9's held-out rows (ids and uploaders). The locked holdout is SampleRadar,
Iowa MIS and BBC SFX, a different source family; dedupe.py still checks decoded PCM and CLAP near-duplicates against it.
Caps per uploader keep one recordist from dominating; the uploader is the fold group.
"""
import csv, glob, hashlib, io, json, os, re, subprocess, sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

MIRROR = 'https://huggingface.co/datasets/benjamin-paine/freesound-laion-640k/resolve/main/data/'
IMPACT = ['Thump, thud', 'Slam', 'Knock', 'Bang', 'Whack, thwack', 'Smash, crash', 'Breaking', 'Clatter', 'Hammer', 'Chop', 'Wood']
LIC = {0: 'CC0-1.0', 1: 'CC-BY-4.0', 2: 'CC-BY-3.0'}
CAP = {'bass guitar': 10, 'foley hit': 4, 'hard negative': 3, 'drum negative': 3}
LIMIT = {'bass guitar': 700, 'foley hit': 600, 'hard negative': 600, 'drum negative': 400}
# Drum loops and kits with no bass: music a bass guitar head must not fire on.
DRUM_CLASSES = ['Drum kit', 'Drum machine', 'Drum', 'Snare drum', 'Hi-hat']
DRUM_TEXT = r'drum|beat|break|loop|groove|perc'
# Low sounds that are not a bass guitar: what a bass guitar head must learn to refuse.
OTHER_CLASSES = ['Double bass', 'Electric guitar', 'Bass drum', 'Synthesizer', 'Cello']
OTHER_TEXT = r'double ?bass|upright|contra ?bass|cello|guitar|808|sub ?bass|synth|reese|wobble|bass ?drum|kick|moog'
BASS_GUITAR_TEXT = r'bass ?guitar|electric bass|bassist|precision bass|jazz bass|fretless|slap bass|p-bass|j-bass'
BASS = r'\bbass(es)?\b|\bbajo\b|\bbasse\b'
NOT_BASS_GUITAR = r'double ?bass|upright|contra ?bass|contrabass|synth|808|sub ?bass|bass ?drum|kick|bassoon|clarinet|flute|trombone|tuba|sax|baritone|voice|vocal|singer|moog|reese|wobble|dubstep'
IMPACT_TEXT = r'impact|\bhit|knock|punch|slam|thud|bang|smash|crash|clank|thump|strike|whack|slap|foley|\bdrop|chop|break|bump|hammer'
NOT_FOLEY = r'drum|snare|kick|music|loop|\bbeat|bpm|cymbal'
h8 = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)

def dynamic_reserved(u):
    return (h8('synth-fresh-up|freesound-user:' + u) % 5 == 0 or h8('dj-effects|' + u) % 4 == 0
            or h8('dge-audio-model-freesound-test|' + u) % 10 == 0)

def select(ced, excl, run7, run9, out, only=None, skip=None):
    import numpy as np
    sets = json.load(open(excl))['sets']
    # Held-out and reserved ids and uploaders are test material and never train. The manifest's "prior" sets
    # (freesoundIds, freesoundUploaders) only mark material that is not new; round two may reuse it.
    bad_ids = set(map(str, sets['heldoutFreesoundIds'])) | set(map(str, sets['reservedFreesoundIds']))
    bad_users = {u.casefold() for k in ('heldoutFreesoundUploaders', 'reservedFreesoundUploaders') for u in sets[k]}
    for path in (run7, run9):
        for r in csv.DictReader(open(path)):
            if r['split'] != 'train': bad_ids.add(str(r['freesound_id'])); bad_users.add(r['username'].casefold())
    labels = [l.strip() for l in open(os.path.join(ced, 'part-0', 'labels.txt'))]
    col = {l: i for i, l in enumerate(labels)}
    imp = [col[l] for l in IMPACT]
    # The run's own per-tag shortlist (candidates.csv, its ced-tag-map classes) also nominates foley hits.
    mapped = {r['freesound_id']: float(r['score']) for r in csv.DictReader(open(os.path.join(ced, 'candidates.csv'))) if r['tag'] == 'foley hit'}
    pool, why = defaultdict(list), Counter()
    for f in sorted(glob.glob(os.path.join(ced, 'part-*', '*.npz'))):
        shard = os.path.basename(f)[:-4]; d = np.load(f)
        probs = d['probs'].astype(np.float32)
        for row in range(len(d['freesound_id'])):
            fid, user, lic = str(d['freesound_id'][row]), str(d['username'][row]), int(d['license'][row])
            p = probs[row]; bass, dbl, egt = p[col['Bass guitar']], p[col['Double bass']], p[col['Electric guitar']]
            other = max(p[col[c]] for c in OTHER_CLASSES); drums = max(p[col[c]] for c in DRUM_CLASSES)
            hit = max(p[imp].max(), mapped.get(fid, 0))
            kind = ('bass guitar' if bass >= .3 else 'foley hit' if hit >= .5 else
                    'hard negative' if other >= .6 and bass < .1 else
                    'drum negative' if drums >= .6 and bass < .05 else None)
            if not kind: continue
            if lic not in LIC: why[f'{kind}: licence not CC0/BY'] += 1; continue
            if fid in bad_ids: why[f'{kind}: id in an exclusion set'] += 1; continue
            if user.casefold() in bad_users: why[f'{kind}: uploader in an exclusion set'] += 1; continue
            if dynamic_reserved(user): why[f'{kind}: uploader under a dynamic held-out rule'] += 1; continue
            pool[kind].append({'kind': kind, 'freesound_id': fid, 'uploader': user, 'license': LIC[lic], 'shard': shard, 'row': row,
                               'seconds': round(float(d['seconds'][row]), 3), 'ced_bass_guitar': round(float(bass), 3),
                               'ced_double_bass': round(float(dbl), 3), 'ced_electric_guitar': round(float(egt), 3), 'ced_other': round(float(other), 3), 'ced_drums': round(float(drums), 3),
                               'ced_impact': round(float(hit), 3),
                               'ced_impact_class': IMPACT[int(p[imp].argmax())] if p[imp].max() >= mapped.get(fid, 0) else 'ced-tag-map foley hit'})
    plan = []
    for kind, rows in pool.items():
        key = {'bass guitar': 'ced_bass_guitar', 'foley hit': 'ced_impact', 'drum negative': 'ced_drums'}.get(kind, 'ced_other')
        rows.sort(key=lambda r: -r[key]); per = Counter(); kept = []
        for r in rows:
            if per[r['uploader']] >= CAP[kind]: why[f'{kind}: uploader cap ({CAP[kind]})'] += 1; continue
            if len(kept) >= LIMIT[kind]: why[f'{kind}: over the {LIMIT[kind]}-clip limit'] += 1; continue
            per[r['uploader']] += 1; kept.append(r)
        plan += kept
    if only:
        done = {r['freesound_id'] for r in csv.DictReader(open(skip))} if skip else set()
        plan = [r for r in plan if r['kind'] == only and r['freesound_id'] not in done]
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'plan.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, list(plan[0])); w.writeheader(); w.writerows(plan)
    summary = {'planned': dict(Counter(r['kind'] for r in plan)), 'row_groups_hint': len({(r['shard'], r['row'] // 80) for r in plan}), 'dropped': dict(why)}
    json.dump(summary, open(os.path.join(out, 'select-summary.json'), 'w'), indent=1); print(json.dumps(summary, indent=1))

class HTTPFile(io.RawIOBase):
    # A seekable read-only view of a remote file, so pyarrow fetches only the byte ranges it needs.
    def __init__(self, url):
        import requests
        self.url, self.pos, self.ses = url, 0, requests.Session()
        self.size = int(self.ses.head(url, allow_redirects=True, timeout=60).headers['Content-Length'])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, o, w=0):
        self.pos = o if w == 0 else self.pos + o if w == 1 else self.size + o; return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        if n <= 0 or self.pos >= self.size: return b''
        end = min(self.size, self.pos + n) - 1
        want = end - self.pos + 1
        for attempt in range(5):
            try:
                r = self.ses.get(self.url, headers={'Range': f'bytes={self.pos}-{end}'}, allow_redirects=True, timeout=300)
                r.raise_for_status(); data = r.content
                if len(data) == want: break
                # A server that ignores Range sends the whole file; never hand that to pyarrow as this range.
                if attempt == 4: raise IOError(f'range {self.pos}-{end}: got {len(data)} bytes, wanted {want}')
            except Exception:
                if attempt == 4: raise
        self.pos += want; return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

def fetch_shard(out, shard, wanted):
    import pyarrow.parquet as pq
    pf = pq.ParquetFile(HTTPFile(MIRROR + shard + '.parquet'))
    # CED skipped Sampling+ rows, so npz row numbers are not parquet row numbers: find each planned id in the shard.
    ids = [str(x) for x in pf.read(columns=['freesound_id']).column('freesound_id').to_pylist()]
    where = {fid: k for k, fid in enumerate(ids)}
    bounds, start = [], 0
    for g in range(pf.metadata.num_row_groups):
        n = pf.metadata.row_group(g).num_rows; bounds.append((start, start + n)); start += n
    results = [(w, None, 'id not in shard') for w in wanted if w['freesound_id'] not in where]
    for g, (a, b) in enumerate(bounds):
        here = [w for w in wanted if w['freesound_id'] in where and a <= where[w['freesound_id']] < b]
        if not here: continue
        t = pf.read_row_group(g, columns=['audio', 'title', 'description', 'tags', 'freesound_id', 'username', 'license'])
        for w in here:
            i = where[w['freesound_id']] - a; fid = str(t.column('freesound_id')[i].as_py())
            if fid != w['freesound_id']: results.append((w, None, f'row order mismatch ({fid})')); continue
            # The plan's uploader and licence come from the CED run; keep the row only if the parquet row agrees.
            if str(t.column('username')[i].as_py()).casefold() != w['uploader'].casefold(): results.append((w, None, 'uploader mismatch')); continue
            if LIC.get(t.column('license')[i].as_py()) != w['license']: results.append((w, None, 'licence mismatch')); continue
            text = ' '.join([t.column('title')[i].as_py() or '', ' '.join(t.column('tags')[i].as_py() or [])]).lower()
            audio = t.column('audio')[i].as_py()['bytes']
            wav = os.path.join(out, 'audio', f'fs{fid}.wav')
            try:
                p = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', 'pipe:0', '-t', '10', '-ac', '1', '-ar', '48000', wav],
                                   input=audio, capture_output=True, timeout=120)
                ok = not p.returncode and os.path.exists(wav)
                if ok:
                    p = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
                                       capture_output=True, timeout=120)
                    ok = not p.returncode and bool(p.stdout)
                why = 'undecodable'
            except subprocess.TimeoutExpired:
                ok, why = False, 'decode timed out'
            if not ok:
                if os.path.exists(wav): os.remove(wav)
                results.append((w, None, why)); continue
            pcm = p.stdout
            results.append((w, {'text': text, 'title': (t.column('title')[i].as_py() or '')[:120], 'encoded_sha256': hashlib.sha256(audio).hexdigest(),
                                'pcm16k_sha256': hashlib.sha256(pcm).hexdigest(), 'duration_s': round(len(pcm) / 32000, 3), 'wav': wav}, None))
    return results

def label(w, got):
    text = got['text']
    if w['kind'] == 'bass guitar':
        if re.search(BASS, text) and not re.search(NOT_BASS_GUITAR, text):
            return {'bass guitar': 1, 'foley hit': 0}, f"CED Bass guitar {w['ced_bass_guitar']}; uploader text names a bass"
        return None, 'bass guitar: uploader text does not confirm a bass guitar'
    if w['kind'] == 'foley hit':
        if re.search(IMPACT_TEXT, text) and not re.search(NOT_FOLEY, text):
            return {'bass guitar': 0, 'foley hit': 1}, f"CED {w['ced_impact_class']} {w['ced_impact']}; uploader text names an impact"
        return None, 'foley hit: uploader text does not confirm an impact'
    if w['kind'] == 'hard negative' and re.search(OTHER_TEXT, text) and not re.search(BASS_GUITAR_TEXT, text):
        return {'bass guitar': 0, 'foley hit': ''}, f"CED Bass guitar {w['ced_bass_guitar']}, best other low-sound class {w.get('ced_other', '')}; text names that sound and no bass guitar"
    if w['kind'] == 'drum negative':
        if re.search(DRUM_TEXT, text) and not re.search(r'bass', text):
            return {'bass guitar': 0, 'foley hit': ''}, f"CED drums {w['ced_drums']}, Bass guitar {w['ced_bass_guitar']}; text names drums or a beat and no bass"
        return None, 'drum negative: uploader text does not confirm drums without bass'
    return None, 'hard negative: uploader text does not confirm the other instrument'

def fetch(out, workers):
    plan = list(csv.DictReader(open(os.path.join(out, 'plan.csv'))))
    os.makedirs(os.path.join(out, 'audio'), exist_ok=True)
    by_shard = defaultdict(list)
    for w in plan: by_shard[w['shard']].append(w)
    rows, why = [], Counter()
    with ThreadPoolExecutor(workers) as ex:
        for n, results in enumerate(ex.map(lambda s: fetch_shard(out, s, by_shard[s]), sorted(by_shard))):
            for w, got, err in results:
                if err: why[err if 'mismatch' not in err else 'row order mismatch'] += 1; continue
                lab, ev = label(w, got)
                if not lab:
                    why[ev] += 1; os.remove(got['wav']); continue
                fid, user = w['freesound_id'], w['uploader']
                rows.append({'id': f'fs{fid}', 'freesound_id': fid, 'uploader': user, 'original_url': f'https://freesound.org/people/{user}/sounds/{fid}/',
                             'mirror': MIRROR.rsplit('/resolve', 1)[0], 'license': w['license'] + ' (per mirror metadata)', 'title': got['title'],
                             'duration_s': got['duration_s'], 'encoded_sha256': got['encoded_sha256'], 'pcm16k_sha256': got['pcm16k_sha256'],
                             'bass guitar': lab['bass guitar'], 'foley hit': lab['foley hit'], 'laser': '', 'label_evidence': ev,
                             'review_status': 'auto-checked (not listened)', 'fold_group': f'freesound:{user}', 'split': 'train',
                             'transformations': 'first 10 s, mono 48 kHz', 'path': got['wav']})
            if n % 50 == 0: print(f'{n + 1}/{len(by_shard)} shards, {len(rows)} kept', flush=True)
    with open(os.path.join(out, 'positives.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, ['id', 'freesound_id', 'uploader', 'original_url', 'mirror', 'license', 'title', 'duration_s', 'encoded_sha256',
                               'pcm16k_sha256', 'bass guitar', 'foley hit', 'laser', 'label_evidence', 'review_status', 'fold_group', 'split',
                               'transformations', 'path'])
        w.writeheader(); w.writerows(rows)
    summary = {'kept': {'bass guitar': sum(r['bass guitar'] == 1 for r in rows), 'foley hit': sum(r['foley hit'] == 1 for r in rows),
                        'bass guitar negatives': sum(r['bass guitar'] == 0 and r['foley hit'] == '' for r in rows)},
               'uploaders': len({r['uploader'] for r in rows}), 'dropped': dict(why)}
    json.dump(summary, open(os.path.join(out, 'fetch-summary.json'), 'w'), indent=1); print(json.dumps(summary, indent=1))

if __name__ == '__main__':
    if sys.argv[1] == 'select': select(*sys.argv[2:9])
    elif sys.argv[1] == 'fetch': fetch(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6)
    else: sys.exit(__doc__)
