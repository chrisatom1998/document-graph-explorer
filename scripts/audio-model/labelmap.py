"""Which training data teaches which of the app's sound tags (src/audio/djCatalog.json), for the tagger's third head.

The third head's outputs are named 'cat:<catalog label>'. Each one is taught by one or more of:
  * FSD50K dev (human-labelled Freesound clips; a clip lists every class heard, so a missing class is an absence),
  * NSynth train (single notes with an instrument family, source and annotated sound qualities),
  * effect renders (NSynth notes re-rendered with one DSP effect; render.py).
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

def cat_labels():
    s = {l for v in FSD50K.values() for l in v} | set(NSYNTH_TAUGHT) | set(NSYNTH_QUALITIES.values()) | set(EFFECTS)
    return sorted(s)
CAT = cat_labels()
