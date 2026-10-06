"""Which training data teaches which of the app's sound tags (src/audio/djCatalog.json), for the tagger's third head.

The third head's outputs are named 'cat:<catalog label>'. Each one is taught by one or more of:
  * FSD50K dev (human-labelled Freesound clips; a clip lists every class heard, so a missing class is an absence),
  * NSynth train (single notes with an instrument family, source and annotated sound qualities),
  * effect renders (NSynth notes re-rendered with one DSP effect; render.py),
  * Freesound sounds named by their uploader tags (FREESOUND below),
  * TinySOL, EGFxSet, WaivOps drum loops and Surge preset renders (prepare-extra.py).
A tag none of them covers is not an output: the app keeps its CLAP zero-shot score for it.
"""

# FSD50K class -> catalog labels. Parents (e.g. Guitar for Electric_guitar) are listed in FSD50K too, so a clip with
# any mapped class is a positive and a clip with none is an absence.
FSD50K = {
    'Accordion': ['accordion'], 'Acoustic_guitar': ['acoustic guitar', 'guitar'], 'Electric_guitar': ['electric guitar', 'guitar'],
    'Guitar': ['guitar'], 'Bass_guitar': ['bass guitar'], 'Bell': ['bell'], 'Church_bell': ['bell'], 'Bowed_string_instrument': ['strings'],
    'Trumpet': ['trumpet'], 'Drum_kit': ['drums'], 'Percussion': ['percussion'], 'Glockenspiel': ['glockenspiel', 'mallet instrument'],
    'Marimba_and_xylophone': ['mallet instrument'], 'Mallet_percussion': ['mallet instrument'], 'Gong': ['gong'], 'Harmonica': ['harmonica'],
    'Harp': ['harp'], 'Organ': ['organ'], 'Piano': ['piano'], 'Tabla': ['tabla'],
    'Human_voice': ['voice'], 'Singing': ['voice'], 'Male_singing': ['voice'], 'Female_singing': ['voice'],
    'Speech': ['voice', 'spoken phrase'], 'Male_speech_and_man_speaking': ['voice', 'spoken phrase'],
    'Female_speech_and_woman_speaking': ['voice', 'spoken phrase'], 'Child_speech_and_kid_speaking': ['voice', 'spoken phrase'],
    'Whispering': ['whisper', 'voice'], 'Shout': ['vocal shout', 'voice'], 'Yell': ['vocal shout', 'voice'], 'Screaming': ['vocal scream', 'voice'],
    'Laughter': ['vocal laugh'], 'Giggle': ['vocal laugh'], 'Chuckle_and_chortle': ['vocal laugh'], 'Gasp': ['vocal gasp'],
    'Breathing': ['breath', 'vocal breath'], 'Sigh': ['breath'],
    'Animal': ['animal sound'], 'Bird_vocalization_and_bird_call_and_bird_song': ['bird ambience', 'animal sound'],
    'Rain': ['rain ambience', 'environmental sound'], 'Raindrop': ['rain ambience'], 'Thunderstorm': ['rain ambience', 'environmental sound'],
    'Stream': ['water ambience', 'environmental sound'], 'Ocean': ['water ambience', 'environmental sound'],
    'Waves_and_surf': ['water ambience', 'environmental sound'], 'Trickle_and_dribble': ['water ambience'],
    'Wind': ['wind ambience', 'environmental sound'], 'Crowd': ['crowd ambience'], 'Cheering': ['crowd ambience'], 'Applause': ['crowd ambience'],
    'Siren': ['siren'], 'Whoosh_and_swoosh_and_swish': ['whoosh'], 'Scratching_(performance_technique)': ['vinyl scratch', 'turntable'],
    'Bass_drum': ['kick'], 'Snare_drum': ['snare'], 'Hi-hat': ['hi-hat'], 'Crash_cymbal': ['crash cymbal', 'cymbal'], 'Cymbal': ['cymbal'],
    'Clapping': ['clap'], 'Finger_snapping': ['finger snap'], 'Cowbell': ['cowbell'], 'Tambourine': ['tambourine'],
    'Mechanical_fan': ['machine ambience'], 'Engine': ['machine ambience'], 'Idling': ['machine ambience'], 'Power_tool': ['machine ambience'],
    'Door': ['foley'], 'Knock': ['foley'], 'Walk_and_footsteps': ['foley'], 'Keys_jangling': ['foley'], 'Crumpling_and_crinkling': ['foley'],
    'Tearing': ['foley'], 'Zipper_(clothing)': ['foley'], 'Dishes_and_pots_and_pans': ['foley'], 'Cutlery_and_silverware': ['foley'],
    'Drawer_open_or_close': ['foley'], 'Cupboard_open_or_close': ['foley'], 'Scissors': ['foley'], 'Writing': ['foley'],
}

# NSynth (family, source) -> catalog labels; source is acoustic / electronic / synthetic. A note is one instrument,
# so every label NSynth can teach is known for every note (absent unless listed).
def nsynth_labels(family, source):
    out = []
    if source == 'synthetic': out.append('synthesizer')
    if family == 'bass': out.append('synth bass' if source == 'synthetic' else 'bass guitar')
    if family == 'flute': out.append('flute')
    if family == 'guitar': out += ['guitar'] + (['acoustic guitar'] if source == 'acoustic' else ['electric guitar'] if source == 'electronic' else [])
    if family == 'keyboard': out += ['piano'] if source == 'acoustic' else ['electric piano'] if source == 'electronic' else []
    if family == 'mallet': out.append('mallet instrument')
    if family == 'organ': out.append('organ')
    if family == 'string': out.append('strings')
    if family == 'synth_lead': out += ['synth lead', 'synthesizer']
    if family == 'vocal': out.append('voice')
    return sorted(set(out))
NSYNTH_TAUGHT = ['synthesizer', 'synth bass', 'bass guitar', 'flute', 'guitar', 'acoustic guitar', 'electric guitar', 'piano', 'electric piano',
                 'mallet instrument', 'organ', 'strings', 'synth lead', 'voice']
# NSynth's annotated qualities -> catalog character labels (the rest of its qualities have no catalog twin).
NSYNTH_QUALITIES = {'bright': 'bright', 'dark': 'dark', 'distortion': 'distorted', 'percussive': 'percussive', 'reverb': 'reverberant'}

# Effects render.py can apply; each is the catalog label it teaches.
EFFECTS = ['distorted', 'reverberant', 'echoing', 'filtered', 'chorused', 'flanged', 'bitcrushed', 'saturated', 'wobbling', 'swelling',
           'pulsing', 'gliding', 'rising', 'falling', 'bright', 'dark', 'reverse effect', 'stutter effect', 'record stop', 'vinyl crackle', 'static noise']

# OpenMIC / Jamendo outputs that name an app tag (the 'cat:' outputs name theirs directly).
SAME = {'accordion': 'accordion', 'banjo': 'banjo', 'cello': 'cello', 'clarinet': 'clarinet', 'cymbals': 'cymbal', 'drums': 'drums', 'flute': 'flute',
        'guitar': 'guitar', 'mallet_percussion': 'mallet instrument', 'mandolin': 'mandolin', 'organ': 'organ', 'piano': 'piano', 'saxophone': 'saxophone',
        'synthesizer': 'synthesizer', 'trombone': 'trombone', 'trumpet': 'trumpet', 'ukulele': 'ukulele', 'violin': 'violin / fiddle', 'voice': 'voice',
        'bass': 'bass guitar',
        'jamendo:accordion': 'accordion', 'jamendo:acousticguitar': 'acoustic guitar', 'jamendo:classicalguitar': 'acoustic guitar',
        'jamendo:acousticbassguitar': 'bass guitar', 'jamendo:bell': 'bell', 'jamendo:bongo': 'bongo', 'jamendo:cello': 'cello', 'jamendo:clarinet': 'clarinet',
        'jamendo:doublebass': 'double bass', 'jamendo:drums': 'drums', 'jamendo:electricguitar': 'electric guitar', 'jamendo:electricpiano': 'electric piano',
        'jamendo:rhodes': 'electric piano', 'jamendo:flute': 'flute', 'jamendo:guitar': 'guitar', 'jamendo:harmonica': 'harmonica', 'jamendo:harp': 'harp',
        'jamendo:horn': 'horn', 'jamendo:oboe': 'oboe', 'jamendo:organ': 'organ', 'jamendo:pipeorgan': 'organ', 'jamendo:pad': 'atmospheric pad',
        'jamendo:percussion': 'percussion', 'jamendo:piano': 'piano', 'jamendo:saxophone': 'saxophone', 'jamendo:strings': 'strings',
        'jamendo:synthesizer': 'synthesizer', 'jamendo:trombone': 'trombone', 'jamendo:trumpet': 'trumpet', 'jamendo:viola': 'viola',
        'jamendo:violin': 'violin / fiddle', 'jamendo:voice': 'voice'}

# Tags nothing above teaches, taught by Freesound sounds whose uploader tags or title name them (prepare-freesound.py):
# every catalog tag outside the lists above with at least 25 tagged sounds from 8 or more uploaders in the Freesound
# metadata dump (2026-10-06). Uploader tags are noisy and a missing tag is no evidence of absence.
FREESOUND = [
    '808 bass', 'acid bass', 'acid synth', 'air horn', 'airy', 'bass growl', 'bass hit', 'bassoon', 'beatbox', 'breakbeat', 'cajon',
    'chiptune synth', 'choir', 'chops', 'clave', 'closed hi-hat', 'conga', 'djembe', 'downlifter', 'drum fill', 'drum loop', 'dry',
    'fm synth', 'foghorn bass', 'foley hit', 'glassy', 'glitch effect', 'gritty', 'hand percussion', 'hi-hat loop', 'hollow', 'impact',
    'jaw harp', 'kalimba', 'laser', 'marimba', 'metallic', 'nasal', 'noise', 'noise sweep', 'open hi-hat', 'percussion hit',
    'percussion loop', 'plucked', 'reese bass', 'rhythmic', 'ride cymbal', 'rimshot', 'riser', 'rolling', 'shaker', 'singing bowl', 'sitar',
    'smooth', 'snare roll', 'sound effect', 'staccato', 'steel drum', 'sub bass', 'sub drop', 'sustained', 'syncopated', 'synth arpeggio',
    'synth chord', 'synth drone', 'synth pluck', 'synth sequence', 'synth stab', 'texture', 'tom', 'top loop', 'triangle', 'tuba',
    'vibraphone', 'vocal chant', 'vocal chops', 'vocal hum', 'vocal vowel', 'vocoder vocal', 'warm', 'waterphone', 'whistle', 'wobble bass',
    'woodblock', 'woody', 'xylophone',
]


# prepare-extra.py sources. Each lists the catalog labels it knows for every one of its clips (present or absent).
# TinySOL (Zenodo 3685367): recorded orchestral notes; 'Instrument (in full)' -> labels.
TINYSOL = {'Accordion': ['accordion'], 'Alto Saxophone': ['saxophone'], 'Bass Tuba': ['tuba'], 'Bassoon': ['bassoon'], 'Violoncello': ['cello', 'strings'],
           'Cello': ['cello', 'strings'], 'Clarinet in Bb': ['clarinet'], 'Contrabass': ['double bass', 'strings'], 'Flute': ['flute'], 'French Horn': ['horn'],
           'Oboe': ['oboe'], 'Trombone': ['trombone'], 'Trumpet in C': ['trumpet'], 'Viola': ['viola', 'strings'], 'Violin': ['violin / fiddle', 'strings']}
# EGFxSet (Zenodo 7044411): one electric-guitar note through a real pedal; zip name -> labels. Overdrive pedals are
# saturated, the RAT distorted; each leaves the other one unknown. Phaser has no catalog twin and is left out.
EGFX = {'Clean': ['dry'], 'Chorus': ['chorused'], 'Flanger': ['flanged'], 'Hall-Reverb': ['reverberant'], 'Plate-Reverb': ['reverberant'],
        'Spring-Reverb': ['reverberant'], 'Digital-Delay': ['echoing'], 'TapeEcho': ['echoing'], 'Sweep-Echo': ['echoing'],
        'TubeScreamer': ['saturated'], 'BluesDriver': ['saturated'], 'RAT': ['distorted']}
EGFX_TAUGHT = ['dry', 'chorused', 'flanged', 'reverberant', 'echoing', 'saturated', 'distorted', 'guitar', 'electric guitar']
# WaivOps EDM-HSE / EDM-TECH (Zenodo 13769544, 17584890): rendered drum loops whose MIDI notes are listed per loop, so a
# drum sound is present exactly when its note is. Key-map label (lower case, substring) -> catalog labels.
WAIVOPS = [('kick', ['kick']), ('rimshot', ['rimshot']), ('snare', ['snare']), ('clap', ['clap']), ('tom', ['tom']), ('drum synth', ['tom']),
           ('closed hat', ['closed hi-hat', 'hi-hat']), ('accent hat', ['closed hi-hat', 'hi-hat']), ('open hat', ['open hi-hat', 'hi-hat']),
           ('ride', ['ride cymbal', 'cymbal']), ('tambourine', ['tambourine', 'percussion']), ('conga', ['conga', 'percussion']),
           ('cabasa', ['shaker', 'percussion']), ('maracas', ['shaker', 'percussion']), ('shaker', ['shaker', 'percussion']),
           ('claves', ['clave', 'percussion']), ('wood block', ['woodblock', 'percussion']), ('percussion', ['percussion'])]
WAIVOPS_TAUGHT = sorted({l for _, ls in WAIVOPS for l in ls} | {'drums', 'drum loop', 'cymbal'})
# Surge synthesizer preset renders (Zenodo 4677097): the preset's category folder and name words -> labels.
SURGE_CATEGORY = {'Leads': ['synth lead'], 'Lead': ['synth lead'], 'Basses': ['synth bass'], 'Bass': ['synth bass'], 'Plucks': ['synth pluck'],
                  'Pads': ['atmospheric pad'], 'Atmospheres': ['atmospheric pad'], 'Ambiance': ['atmospheric pad'], 'Brass': ['brass synth'],
                  'String': ['string synth'], 'Strings': ['string synth'], 'Organs': ['organ synth'], 'Bells': ['bell synth'], 'Vox': ['vocal-like synth'],
                  'Arps': ['synth arpeggio'], 'Sequences': ['synth sequence'], 'Chords': ['synth chord'], 'Fifths': ['synth chord'], 'FM': ['fm synth']}
SURGE_WORDS = [('supersaw', ['supersaw']), ('reese', ['reese bass']), ('acid', ['acid synth']), ('303', ['acid synth']), ('wobb', ['wobble bass']),
               ('growl', ['bass growl']), ('808', ['808 bass']), ('chip', ['chiptune synth']), ('stab', ['synth stab']), ('drone', ['synth drone']),
               ('choir', ['vocal-like synth']), ('vox', ['vocal-like synth']), ('vocal', ['vocal-like synth']), ('bell', ['bell synth']),
               ('organ', ['organ synth']), ('string', ['string synth']), ('brass', ['brass synth']), ('horn', ['brass synth']), ('pluck', ['synth pluck']),
               ('pad', ['atmospheric pad']), ('lead', ['synth lead']), ('arp', ['synth arpeggio'])]
SURGE_ROLES = sorted({l for v in SURGE_CATEGORY.values() for l in v} | {l for _, v in SURGE_WORDS for l in v} | {'sub bass', 'acid bass', 'bass pluck'})
# Freesound Loop Dataset (Zenodo 3967852) expert instrumentation ticks: kept as their own outputs ('fsld:<role>'), plus
# the fx tick as the app's 'sound effect'.
FSLD_ROLES = ['percussion', 'bass', 'chords', 'melody', 'fx', 'vocal']

def cat_labels():
    s = {l for v in FSD50K.values() for l in v} | set(NSYNTH_TAUGHT) | set(NSYNTH_QUALITIES.values()) | set(EFFECTS) | set(FREESOUND)
    s |= {l for v in TINYSOL.values() for l in v} | set(EGFX_TAUGHT) | set(WAIVOPS_TAUGHT) | set(SURGE_ROLES) | {'synthesizer', 'sound effect'}
    return sorted(s)
CAT = cat_labels()
