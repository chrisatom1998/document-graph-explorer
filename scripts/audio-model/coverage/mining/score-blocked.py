"""Mine the blocked tags (mandolin, bongo, oboe, synth basses): CLAP text-prompt scores + CED classes for every clip that
already has round 11 teacher features, plus the text metadata of the whole Freesound mirror. Runs as an HF job. No audio.

Env: FEAT (mounted round11 features dir of cmjatom/dge-audio-training), OUT (mounted output dir), SETS (comma list of
feature sub-dirs, default mirror,mirror-b,run9,commercial,emptytags).
Writes OUT/<set>.npz (id, username, license, seconds, cos [N, classes] float16, ced [N, CED_KEEP] float16), OUT/classes.json
and OUT/mirror-meta.csv.gz (freesound_id, username, licence code, title, tags, description[:300]) for all mirror clips.
The round 11 teacher can't vote on these tags (out-of-fold precision 0.00-0.09), so CLAP's text tower is a new, independent
vote; deciding which clips to keep (keywords, cutoffs, held-out rules) happens later in the container on these scores.
"""
import concurrent.futures as cf, csv, glob, gzip, json, os, sys, time

import numpy as np
import torch

TARGETS = {
    'mandolin': ['a mandolin being played', 'mandolin strumming', 'fast mandolin tremolo picking', 'a plucked mandolin melody'],
    'bongo': ['bongo drums', 'a pair of bongos played by hand', 'bongo drum hits', 'latin percussion on bongos'],
    'oboe': ['an oboe playing a melody', 'an oboe solo', 'a sustained oboe note', 'a double reed woodwind, the oboe'],
    'synth bass': ['a synth bass line', 'an analog synthesizer bass', 'an electronic bass synth', 'a deep synthesizer bassline'],
    'reese bass': ['a reese bass', 'a detuned drum and bass reese bass', 'a dark neurofunk bass', 'a wide detuned saw wave bass'],
    '808 bass': ['an 808 bass', 'a booming tr-808 bass', 'a trap 808 bass', 'a long decaying 808 kick bass'],
    'sub bass': ['a sub bass', 'a deep sine wave sub bass', 'a very low frequency bass tone', 'a sub bass drone'],
    'wobble bass': ['a wobble bass', 'a dubstep wobble bass', 'a bass synth wobbling with an lfo', 'a wub wub dubstep bass'],
    'acid bass': ['an acid bass', 'a tb-303 acid bassline', 'a squelchy resonant acid synth', 'an acid house 303 line'],
    'bass growl': ['a growl bass', 'a growling dubstep bass', 'an aggressive talking bass synth'],
    'foghorn bass': ['a foghorn bass', 'a huge foghorn-like bass blast', 'a deep brass horn bass hit'],
}
# competing sounds a target is easily confused with; a clip counts for a tag only when the tag beats all of these
DISTRACT = ['acoustic guitar', 'electric guitar', 'banjo', 'ukulele', 'sitar', 'harp', 'violin', 'cello', 'double bass', 'bass guitar',
            'clarinet', 'flute', 'bassoon', 'saxophone', 'trumpet', 'french horn', 'trombone', 'tuba', 'english horn', 'harmonica',
            'accordion', 'conga drums', 'djembe', 'tabla', 'cajon', 'timbales', 'snare drum', 'kick drum', 'drum kit', 'tambourine',
            'shaker', 'woodblock', 'marimba', 'piano', 'organ', 'a synth lead melody', 'a synth pad', 'a synth arpeggio',
            'an electronic drum beat', 'a singing voice', 'speech', 'white noise', 'a field recording of nature',
            'a sound effect', 'a bell', 'an explosion', 'a distorted electric guitar riff', 'a car engine', 'a low rumble']
CED_KEEP = ['Mandolin', 'Plucked string instrument', 'Guitar', 'Drum', 'Percussion', 'Tabla', 'Bass drum', 'Drum kit',
            'Wind instrument, woodwind instrument', 'Clarinet', 'Flute', 'Brass instrument', 'Synthesizer', 'Electronic music',
            'Dubstep', 'Drum and bass', 'Bass guitar', 'Music', 'Speech']
TEMPLATES = ['{}', 'the sound of {}', 'this is a recording of {}']


def text_matrix():
    from transformers import ClapModel, ClapProcessor
    m = ClapModel.from_pretrained('laion/larger_clap_music_and_speech').eval(); pr = ClapProcessor.from_pretrained('laion/larger_clap_music_and_speech')
    names, rows = [], []
    def emb(texts):
        with torch.no_grad():
            e = m.get_text_features(**pr(text=texts, return_tensors='pt', padding=True))
        e = torch.nn.functional.normalize(e, dim=-1).mean(0)
        return torch.nn.functional.normalize(e, dim=0).numpy()
    for t, ps in TARGETS.items():
        names.append(t); rows.append(emb([tpl.format(p) for p in ps for tpl in TEMPLATES]))
    for d in DISTRACT:
        names.append('~' + d); rows.append(emb([tpl.format(d) for tpl in TEMPLATES]))
    return names, np.stack(rows).astype(np.float32)


def score_set(feat, s, W, keep_idx, out):
    files = sorted(glob.glob(os.path.join(feat, s, '*.npz')))
    acc = {k: [] for k in ('id', 'username', 'license', 'seconds', 'cos', 'ced')}
    for fn in files:
        z = np.load(fn, allow_pickle=True)
        a = z['clap'].astype(np.float32); a /= np.linalg.norm(a, axis=1, keepdims=True) + 1e-9
        acc['cos'].append((a @ W.T).astype(np.float16)); acc['ced'].append(z['ced_probs'][:, keep_idx].astype(np.float16))
        acc['id'].append(z['id'].astype(str)); acc['seconds'].append(z['seconds'].astype(np.float32))
        n = len(z['id'])
        acc['username'].append(z['username'].astype(str) if 'username' in z.files else np.array([''] * n))
        acc['license'].append(z['license'].astype(np.int16) if 'license' in z.files else np.full(n, -1, np.int16))
    if not files: print(f'{s}: no files', flush=True); return
    np.savez_compressed(os.path.join(out, f'{s}.npz'), **{k: np.concatenate(v) for k, v in acc.items()})
    print(f'{s}: {sum(len(x) for x in acc["id"])} clips from {len(files)} files', flush=True)


def mirror_meta(out):
    from huggingface_hub import HfFileSystem
    import pyarrow.parquet as pq
    fs = HfFileSystem(); fl = fs.glob('datasets/benjamin-paine/freesound-laion-640k/data/*.parquet')
    def one(p):
        for k in range(4):
            try:
                with fs.open(p, block_size=512 * 1024, cache_type='readahead') as f:
                    return pq.ParquetFile(f).read(columns=['freesound_id', 'username', 'license', 'title', 'tags', 'description']).to_pylist()
            except Exception as e:  # noqa: BLE001
                time.sleep(2 ** k); err = e
        print('meta failed', p, err, flush=True); return []
    n = 0
    with gzip.open(os.path.join(out, 'mirror-meta.csv.gz'), 'wt', newline='') as g, cf.ThreadPoolExecutor(16) as ex:
        w = csv.writer(g); w.writerow(['freesound_id', 'username', 'licence', 'title', 'tags', 'description'])
        for rows in ex.map(one, fl):
            for r in rows:
                w.writerow([r['freesound_id'], r['username'], r['license'], r['title'] or '', ' '.join(r['tags'] or []), (r['description'] or '')[:300].replace('\n', ' ')]); n += 1
    print(f'mirror meta: {n} rows from {len(fl)} files', flush=True)


def main():
    feat, out = os.environ['FEAT'], os.environ['OUT']; os.makedirs(out, exist_ok=True)
    sets = os.environ.get('SETS', 'mirror,mirror-b,run9,commercial,emptytags').split(',')
    with cf.ThreadPoolExecutor(1) as ex:
        meta = ex.submit(mirror_meta, out)
        names, W = text_matrix()
        labels = [l.strip() for l in open(os.path.join(feat, 'mirror', 'ced-labels.txt'))]
        keep_idx = [labels.index(c) for c in CED_KEEP]
        json.dump({'classes': names, 'ced': CED_KEEP, 'targets': TARGETS, 'templates': TEMPLATES}, open(os.path.join(out, 'classes.json'), 'w'), indent=1)
        for s in sets: score_set(feat, s, W, keep_idx, out)
        meta.result()
    print('done', flush=True)


if __name__ == '__main__':
    sys.exit(main())
