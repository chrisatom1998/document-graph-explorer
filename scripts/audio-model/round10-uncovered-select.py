# /// script
# dependencies = ["huggingface_hub>=0.24", "pyarrow", "numpy"]
# ///
"""Round 10: pick Freesound candidates for the tags round 9 could not cover (keyword words checked by CED-base).
Reads the public freesound-laion-640k metadata and (optionally) the private CED run's per-clip AudioSet scores.
Writes one CSV row per (tag, clip) kept: tag,route,freesound_id,username,license,seconds,score,kw.
No audio is read or written. Env: CED=1 to use the CED run (needs HF_TOKEN), OUT=<path>, UPLOAD=<repo path> (private repo only)."""
import glob, hashlib, io, json, os, re, sys
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor
import numpy as np, pyarrow.parquet as pq
from huggingface_hub import HfFileSystem

MIRROR = 'datasets/benjamin-paine/freesound-laion-640k/data'
RUN = 'datasets/cmjatom/dge-eval-runs/runs/ced-freesound-38026076860-1'
PER_UPLOADER, PER_TAG = 25, 800
h8 = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
def reserved(u):   # the three reserved-uploader hash rules used by every earlier round
    return h8('synth-fresh-up|freesound-user:' + u) % 5 == 0 or h8('dj-effects|' + u) % 4 == 0 or h8('dge-audio-model-freesound-test|' + u) % 10 == 0

W = lambda *ws: re.compile(r'(?<![a-z])(' + '|'.join(ws) + r')(?![a-z])')
# tag: keyword pattern (title + tags), confirm classes + min, direct classes + min (CED only), veto classes + max
RULES = {
 'echoing': dict(kw=W(r'delay', r'delayed', r'echo', r'echoes', r'echoing', r'echoey', r'dub-?delay', r'ping-?pong', r'tape-?delay', r'multi-?tap'),
                 conf=['Echo'], cmin=.10, direct=['Echo'], dmin=.40),
 'dry':     dict(kw=W(r'dry', r'anechoic', r'close-?mic(?:ed|ked|rophone)?', r'no-?reverb', r'without reverb', r'unprocessed', r'dead room'),
                 conf=['Music', 'Musical instrument', 'Percussion', 'Singing', 'Plucked string instrument', 'Keyboard (musical)'], cmin=.30,
                 veto=['Reverberation', 'Echo', 'Inside, large room or hall'], vmax=.10),
 'rolling': dict(kw=W(r'drum-?roll', r'snare-?roll', r'timpani-?roll', r'tom-?roll', r'cymbal-?roll', r'roll', r'rolls', r'press-?roll', r'buzz-?roll', r'tremolo'),
                 conf=['Drum roll', 'Snare drum', 'Timpani', 'Cymbal', 'Marimba, xylophone', 'Drum', 'Hi-hat'], cmin=.30, direct=['Drum roll'], dmin=.50,
                 veto=['Vehicle', 'Bouncing', 'Roll', 'Skateboard'], vmax=.30),
 'vocal harmony': dict(kw=W(r'harmony', r'harmonies', r'harmonis(?:ed|ing)', r'harmoniz(?:ed|ing)', r'backing-?vocals?', r'choir', r'choral', r'chorus vocals',
                            r'barbershop', r'vocal-?quartet', r'vocal-?ensemble', r'a-?cappella', r'acapella', r'close-?harmony'),
                 conf=['Choir', 'A capella', 'Vocal music', 'Singing'], cmin=.30, direct=['Choir'], dmin=.50, veto=['Speech'], vmax=.40),
 'vocal phrase': dict(kw=W(r'acapella', r'a-?cappella', r'vocal-?phrase', r'vocal-?line', r'vocal-?loop', r'vocal-?melody', r'vocal-?hook', r'sung', r'singing',
                           r'singer', r'female-?vocals?', r'male-?vocals?', r'vocals?', r'lyrics'),
                 conf=['Singing', 'Male singing', 'Female singing', 'A capella', 'Vocal music'], cmin=.40, direct=['A capella'], dmin=.50,
                 veto=['Speech', 'Choir'], vmax=.40),
 'sound effect': dict(kw=W(r'sfx', r'fx', r'transition', r'impact', r'riser', r'swoosh', r'whoosh', r'sweep', r'glitch', r'sound-?design', r'designed',
                           r'cinematic', r'trailer', r'braam', r'stinger', r'zap', r'laser'),
                 conf=['Sound effect', 'Whoosh, swoosh, swish', 'Boom', 'Explosion', 'Zing', 'Effects unit', 'Boing', 'Bang', 'Sonar', 'Chirp tone'], cmin=.30,
                 direct=['Sound effect'], dmin=.50, veto=['Speech'], vmax=.40),
 'texture': dict(kw=W(r'texture', r'textures', r'textural', r'soundscape', r'atmosphere', r'atmospheric', r'atmos', r'drone', r'granular', r'ambient-?noise',
                      r'noise-?texture', r'dark-?ambient'),
                 conf=['Ambient music', 'Noise', 'Environmental noise', 'White noise', 'Pink noise', 'Static', 'Hum', 'Rumble', 'Throbbing', 'Vibration',
                       'Wind noise (microphone)', 'Field recording', 'Electronic music'], cmin=.30, veto=['Speech', 'Singing'], vmax=.30),
 'rhythmic': dict(kw=W(r'loop', r'beat', r'groove', r'rhythm', r'rhythmic', r'pattern', r'ostinato', r'sequence', r'[0-9]{2,3}-?bpm', r'bpm'),
                  conf=['Drum kit', 'Drum machine', 'Drum', 'Percussion', 'Hi-hat', 'Snare drum', 'Bass drum', 'Drum and bass', 'Electronic dance music',
                        'Techno', 'House music', 'Hip hop music', 'Funk', 'Tabla'], cmin=.40, veto=['Speech'], vmax=.30),
 'steel guitar': dict(kw=W(r'pedal-?steel', r'lap-?steel', r'steel-?guitar', r'dobro', r'slide-?guitar', r'bottleneck', r'resonator-?guitar', r'weissenborn',
                           r'hawaiian-?guitar'),
                 conf=['Steel guitar, slide guitar', 'Guitar'], cmin=.15, direct=['Steel guitar, slide guitar'], dmin=.40),
}

def text(r):
    t = (r['title'] or '').lower() + ' | ' + ' '.join(r['tags'] or []).lower()
    return t.replace('_', ' ')

def load_meta(fs, local=None):
    files = sorted(glob.glob(local + '/*.parquet')) if local else sorted(f for f in fs.ls(MIRROR, detail=False) if f.endswith('.parquet'))
    def one(f):
        src = f if local else fs.open(f, block_size=1 << 20)
        return os.path.basename(f)[:-8], pq.ParquetFile(src).read(columns=['freesound_id', 'title', 'tags', 'username', 'license']).to_pylist()
    with ThreadPoolExecutor(24) as ex: return dict(ex.map(one, files))

def main():
    fs = HfFileSystem(token=os.environ.get('HF_TOKEN'))
    meta = load_meta(fs, os.environ.get('META'))
    print('meta shards', len(meta), 'clips', sum(map(len, meta.values())), flush=True)
    use_ced = os.environ.get('CED') == '1'
    ced = {}
    if use_ced:
        labels = fs.read_text(RUN + '/part-0/labels.txt').splitlines()
        idx = {l: i for i, l in enumerate(labels)}
        need = sorted({c for r in RULES.values() for k in ('conf', 'direct', 'veto') for c in r.get(k, [])})
        cols = [idx[c] for c in need]
        npzs = [f for f in fs.glob(RUN + '/part-*/*.npz')]
        def one(f):
            d = np.load(io.BytesIO(fs.read_bytes(f)))
            p = d['probs'][:, cols].astype(np.float32)
            return {int(i): (s, float(sec)) for i, s, sec in zip(d['freesound_id'], p, d['seconds'])}
        with ThreadPoolExecutor(16) as ex:
            for part in ex.map(one, npzs): ced.update(part)
        col = {c: j for j, c in enumerate(need)}
        print('ced clips', len(ced), flush=True)
    rows = defaultdict(list); kwcount = Counter()
    for shard, recs in meta.items():
        for r in recs:
            if r['license'] == 5: continue
            u = r['username'] or ''
            if reserved(u): continue
            sid = int(r['freesound_id']); t = text(r)
            c = ced.get(sid)
            for tag, R in RULES.items():
                m = R['kw'].search(t)
                if m: kwcount[tag] += 1
                if not use_ced:
                    continue
                if c is None: continue
                s, sec = c
                mx = lambda names: max((s[col[n]] for n in names), default=0.0)
                if R.get('veto') and mx(R['veto']) > R['vmax']: continue
                route = None
                if m and mx(R['conf']) >= R['cmin']: route, score = 'keyword+ced', mx(R['conf'])
                if R.get('direct') and mx(R['direct']) >= R['dmin']:
                    route, score = ('keyword+ced-direct' if m else 'ced-direct'), max(mx(R['direct']), score if route else 0)
                if route: rows[tag].append((score, route, sid, u, r['license'], round(sec, 2), m.group(0) if m else ''))
    print('keyword matches', dict(kwcount), flush=True)
    out = open(os.environ.get('OUT', 'round10-uncovered-ced.csv'), 'w')
    out.write('tag,route,freesound_id,username,license,seconds,score,kw\n')
    for tag, lst in rows.items():
        lst.sort(key=lambda x: -x[0]); per = Counter(); kept = 0
        for score, route, sid, u, lic, sec, kw in lst:
            if per[u] >= PER_UPLOADER: continue
            per[u] += 1; kept += 1
            out.write(f'{tag},{route},{sid},{u},{lic},{sec},{score:.3f},{kw}\n')
            if kept >= PER_TAG: break
        print(tag, 'candidates', len(lst), 'kept', kept, flush=True)
    out.close()
    if os.environ.get('UPLOAD'):
        from huggingface_hub import HfApi
        api = HfApi(token=os.environ['HF_TOKEN']); repo = 'cmjatom/dge-private-train'
        assert api.dataset_info(repo).private, 'refusing: repo is not private'
        api.upload_file(path_or_fileobj=out.name, path_in_repo=os.environ['UPLOAD'], repo_id=repo, repo_type='dataset',
                        commit_message='Round 10: CED-checked Freesound candidates for uncovered tags (metadata only)')
        print('uploaded', os.environ['UPLOAD'])

if __name__ == '__main__':
    main()
