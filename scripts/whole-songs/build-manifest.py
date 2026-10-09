"""Freeze the whole-song judge set: MedleyDB and MoisesDB full songs whose every instrument is known from their stems.

Usage: python3 scripts/whole-songs/build-manifest.py <medleydb.parquet> <moisesdb.parquet> <medleydb yaml dir> <out manifest.json>
  medleydb.parquet / moisesdb.parquet: data/train-00000-of-00001.parquet of hf://datasets/seungheondoh/cmd-{medleydb,moisesdb}-metadata
  yaml dir: <medleydb_id>_METADATA.yaml from github.com/marl/medleydb (medleydb/data/Metadata), which also names the singers
            and whether a song is instrumental (the parquet's instrument lists leave voices out).
Every song gets an opaque id; each catalog tag is 'present', 'absent' or left out (unknown) for it, by the rules in RULES.
Unknown is used wherever the stems can't settle a tag: e.g. 'brass section' leaves trumpet, trombone, horn and tuba unknown,
and a drum set recorded without its own hi-hat track leaves hi-hat unknown (the overheads hear it).
"""
import hashlib, json, os, sys
import pandas as pd, yaml

# Instrument (MedleyDB or MoisesDB name, lower case) -> (tags present, tags unknown).
R = {}
def rule(names, present=(), unknown=()):
    for n in names.split('|'): R[n.strip()] = (set(present), set(unknown))
DRUM_PARTS = ['kick', 'snare', 'tom', 'hi-hat', 'cymbal']
FX = ['sound effect', 'noise', 'foley', 'environmental sound', 'turntable', 'vinyl scratch', 'riser', 'downlifter', 'impact', 'whoosh',
      'reverse cymbal', 'reverse impact', 'noise sweep', 'sub drop', 'laser', 'siren', 'air horn', 'record stop', 'stutter effect',
      'glitch effect', 'reverse effect', 'texture', 'ambient drone', 'vinyl crackle', 'static noise', 'synthesizer']
HAND = ['hand percussion', 'shaker', 'tambourine', 'clap', 'conga', 'bongo', 'cowbell', 'clave', 'woodblock', 'triangle', 'cajon', 'djembe', 'finger snap']
WINDS = ['flute', 'clarinet', 'oboe', 'bassoon', 'saxophone', 'harmonica', 'whistle']
BRASS = ['trumpet', 'trombone', 'horn', 'tuba', 'saxophone']
PLUCKED = ['guitar', 'acoustic guitar', 'mandolin', 'banjo', 'ukulele', 'harp', 'sitar', 'strings', 'violin / fiddle']
VOCAL = ['voice', 'choir', 'vocal chops', 'vocal phrase', 'spoken phrase', 'whisper', 'vocal shout', 'vocal chant', 'vocal ad-lib', 'vocal hum',
         'vocal harmony', 'vocal scream', 'vocoder vocal', 'pitched vocal', 'vocal breath', 'breath']
# Drums
rule('drum set|full_acoustic_drumkit|drum machine|drum_machine', ['drums'], DRUM_PARTS + ['percussion'])
rule('overheads', ['drums'], DRUM_PARTS + ['percussion'])
rule('kick drum|kick_drum|bass drum', ['drums', 'kick'], ['percussion'])
rule('snare drum|snare_drum', ['drums', 'snare'], ['percussion'])
rule('toms', ['drums', 'tom'], ['percussion'])
rule('high hat|hi_hat', ['drums', 'hi-hat'], ['percussion'])
rule('cymbal|cymbals', ['drums', 'cymbal'], ['percussion'])
# Percussion
rule('auxiliary percussion|a-tonal_percussion_(claps,_shakers,_congas,_cowbell_etc)', ['percussion'], HAND)
rule('tambourine', ['percussion', 'hand percussion', 'tambourine'])
rule('shaker', ['percussion', 'hand percussion', 'shaker'])
rule('claps', ['percussion', 'clap'], ['hand percussion'])
rule('cowbell', ['percussion', 'cowbell'])
rule('bongo', ['percussion', 'hand percussion', 'bongo'])
rule('cabasa|guiro|castanet|sleigh bells', ['percussion'], ['hand percussion', 'shaker'])
rule('darbuka|doumbek', ['percussion', 'hand percussion'], ['djembe', 'tabla', 'conga', 'bongo'])
rule('tabla', ['percussion', 'hand percussion', 'tabla'])
rule('gu', ['percussion'], ['hand percussion', 'drums'])
rule('timpani', [], ['percussion', 'tuned percussion', 'drums'])
rule('gong', ['gong'], ['percussion', 'tuned percussion'])
rule('chimes', [], ['bell', 'tuned percussion', 'mallet instrument'])
rule('glockenspiel', ['glockenspiel', 'mallet instrument', 'tuned percussion'], ['bell'])
rule('vibraphone', ['vibraphone', 'mallet instrument', 'tuned percussion'])
rule('pitched_percussion_(mallets,_glockenspiel,_...)', ['mallet instrument', 'tuned percussion'], ['glockenspiel', 'vibraphone', 'marimba', 'xylophone', 'bell', 'steel drum'])
# Bass
rule('electric bass|bass_guitar', ['bass guitar'])
rule('double bass|contrabass/double_bass_(bass_of_instrings)', ['double bass'], ['strings'])
rule('bass_synthesizer_(moog_etc)', ['synth bass', 'synthesizer'], ['sub bass', 'reese bass', 'wobble bass', 'acid bass', '808 bass', 'bass pluck', 'rubbery bass'])
# Guitars and other plucked strings
rule('clean electric guitar|clean_electric_guitar', ['guitar', 'electric guitar'])
rule('distorted electric guitar|distorted_electric_guitar', ['guitar', 'electric guitar'], ['distorted'])
rule('acoustic guitar|acoustic_guitar', ['guitar', 'acoustic guitar'])
rule('lap steel guitar', ['guitar', 'steel guitar'], ['electric guitar'])
rule('banjo', ['banjo'])
rule('mandolin', ['mandolin'])
rule('harp', ['harp'])
rule('banjo,_mandolin,_ukulele,_harp_etc', [], ['banjo', 'mandolin', 'ukulele', 'harp', 'sitar'])
rule('yangqin|guzheng|zhongruan|liuqin|oud', [], PLUCKED + ['mallet instrument', 'tuned percussion'])
# Keys
rule('piano|tack piano|grand_piano', ['piano'])
rule('electric piano|electric_piano_(rhodes,_wurlitzer,_piano_sound_alike)', ['electric piano'], ['piano'])
rule('electronic organ|organ,_electric_organ', ['organ'])
rule('synthesizer', ['synthesizer'], ['synth lead', 'atmospheric pad', 'synth bass', 'synth pluck', 'synth stab', 'synth arpeggio', 'synth chord',
                                      'supersaw', 'synth drone', 'synth sequence', 'string synth', 'brass synth', 'organ synth', 'bell synth'])
rule('synth_pad', ['synthesizer', 'atmospheric pad'], ['synth chord', 'synth drone', 'string synth'])
rule('synth_lead', ['synthesizer', 'synth lead'], ['synth arpeggio', 'synth sequence', 'supersaw'])
rule('accordion', ['accordion'])
rule('harmonica', ['harmonica'])
rule('melodica', [], ['harmonica', 'accordion'])
rule('other_sounds_(hapischord,_melotron_etc)', [], ['piano', 'organ', 'strings', 'flute', 'synthesizer', 'electric piano'])
# Bowed strings
rule('violin', ['violin / fiddle'], ['strings'])
rule('viola', ['viola'], ['strings'])
rule('cello|cello_(solo)', ['cello'], ['strings'])
rule('viola_(solo)', ['viola'], ['strings'])
rule('violin section', ['violin / fiddle', 'strings'])
rule('viola section|viola_section', ['viola', 'strings'])
rule('cello section|cello_section', ['cello', 'strings'])
rule('string section|string_section', ['strings'], ['violin / fiddle', 'viola', 'cello', 'double bass'])
rule('other_strings', [], ['strings', 'violin / fiddle', 'viola', 'cello'] + PLUCKED)
rule('erhu', [], ['strings', 'violin / fiddle'])
# Brass
rule('trumpet|trumpet section|cornet', ['trumpet'])
rule('trombone|trombone section', ['trombone'])
rule('french horn|french horn section', ['horn'])
rule('tuba', ['tuba'])
rule('euphonium', [], ['tuba', 'horn'])
rule('brass section|horn section|brass_(trumpet,_trombone,_french_horn,_brass_etc)', [], BRASS)
# Woodwinds
rule('flute|piccolo|flute section|bamboo flute|dizi|flutes_(piccolo,_bamboo_flute,_panpipes,_flutes_etc)', ['flute'])
rule('clarinet|clarinet section|bass clarinet', ['clarinet'])
rule('oboe', ['oboe'])
rule('bassoon', ['bassoon'])
rule('tenor saxophone|alto saxophone|soprano saxophone|baritone saxophone', ['saxophone'])
rule('reeds_(saxophone,_clarinets,_oboe,_english_horn,_bagpipe)', [], ['saxophone', 'clarinet', 'oboe', 'bassoon'])
rule('other_wind', [], WINDS + BRASS)
rule('whistle', [], ['whistle', 'flute'])
# Voices (MedleyDB only; MoisesDB's lists leave them out, so its voice tags stay unknown)
rule('male singer|female singer|vocalists|male rapper|male speaker|female speaker', ['voice'], VOCAL)
# Anything else that can sound like anything
rule('fx/processed sound|fx/processed_sound,_scratches,_gun_shots,_explosions_etc|scratches', [], FX)
rule('sampler', [], ['*'])
rule('main system', [])

# Tags scored: every source tag plus the production tags an instrument list can settle. Character tags and sample types
# (loops, one-shot hits) are not scored.
CATALOG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../src/audio/djCatalog.json')))['categories']
SCORED = sorted({c['label'] for c in CATALOG if c['group'] == 'source'} | set(DRUM_PARTS) | set(HAND) | set(VOCAL) | set(FX) |
                {'synth lead', 'atmospheric pad', 'synth bass', 'sub bass', 'reese bass', 'wobble bass', 'acid bass', '808 bass'})
assert set(SCORED) <= {c['label'] for c in CATALOG}, sorted(set(SCORED) - {c['label'] for c in CATALOG})

def labels(instruments, voices_known, instrumental):
    present, unknown = set(), set()
    for i in instruments:
        if i.lower() not in R: raise SystemExit(f'no rule for instrument {i!r}')
        p, u = R[i.lower()]; present |= p; unknown |= u
    if not voices_known: unknown |= set(VOCAL)
    elif not instrumental and 'voice' not in present: unknown |= set(VOCAL)    # MedleyDB says it has voice but names no singer stem
    if '*' in unknown: unknown = set(SCORED)
    out = {}
    for t in SCORED:
        if t in present: out[t] = 'present'
        elif t not in unknown: out[t] = 'absent'
    return out

def main():
    mdb, moi, ydir, out = sys.argv[1:5]
    items = []
    for _, r in pd.read_parquet(mdb).iterrows():
        y = yaml.safe_load(open(os.path.join(ydir, f'{r.medleydb_id}_METADATA.yaml')))
        ins = set()
        for st in (y.get('stems') or {}).values():
            for v in [st['instrument']] + [x['instrument'] for x in (st.get('raw') or {}).values()]:
                ins |= set(v if isinstance(v, list) else [v])
        items.append(dict(set='medleydb', key=r.medleydb_id, audio=f'medleydb/{r.audio_path}', artist=y.get('artist') or r.medleydb_id.split('_')[0],
                          genre=list(r.genre), excerpt=y.get('excerpt') == 'yes', instruments=sorted(ins),
                          tags=labels(ins, True, y.get('instrumental') == 'yes')))
    for _, r in pd.read_parquet(moi).iterrows():
        ins = set(r.instrument)
        items.append(dict(set='moisesdb', key=r.id, audio=f'moisesdb/{r.audio_path}', artist=None, genre=list(r.genre), excerpt=False,
                          instruments=sorted(ins), tags=labels(ins, False, False)))
    rows = []
    for it in items:
        oid = 'ws-' + hashlib.sha256(f"dge-whole-songs-2026-10-09|{it['set']}|{it['key']}".encode()).hexdigest()[:16]
        art = f"{it['set']}:{it['artist'] or it['key']}"
        rows.append({'id': oid, 'source': f"{'MedleyDB' if it['set'] == 'medleydb' else 'MoisesDB'} {it['key']}", 'archivePath': it['audio'],
                     'rights': {'evaluationAllowed': True, 'basis': 'CC BY-NC-SA 4.0, non-commercial research; audio fetched at run time, never committed'},
                     'groups': {'artist': art, 'original': f"{it['set']}:{it['key']}"}, 'genres': it['genre'], 'excerpt': it['excerpt'],
                     'split': 'test', 'tier': 'song', 'instruments': it['instruments'],
                     'tags': {t: int(s == 'present') for t, s in sorted(it['tags'].items())}})
    rows.sort(key=lambda x: x['id'])
    json.dump({'version': 1, 'frozenAt': '2026-10-09', 'scored': SCORED,
               'selection': 'every MedleyDB (178) and MoisesDB (239) song in hf://datasets/seungheondoh/cmd-{medleydb,moisesdb}-metadata; judge only',
               'tags': 'catalog tag -> 1 present, 0 absent; a tag left out is unknown for that song', 'items': rows},
              open(out, 'w'), separators=(',', ':'))
    from collections import Counter
    pos, neg = Counter(), Counter()
    for r in rows:
        for t, v in r['tags'].items(): (pos if v else neg)[t] += 1
    print(len(rows), 'songs;', ', '.join(f'{t} {pos[t]}/{pos[t] + neg[t]}' for t in sorted(SCORED, key=lambda t: -pos[t]) if pos[t] + neg[t]))

if __name__ == '__main__':
    main()
