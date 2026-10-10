"""App tags that get a tagger output ('cat:<label>') from run 7 on, beyond labelmap.CAT.

Kept out of labelmap.py on purpose: that file is part of the prepared-data cache key (hf-job.sh), and changing it would
re-run the ~3 h cached prep. train.py appends these to its class list; only the uncached run 7 sources label them
(prepare-iowa.py, prepare-vcsl.py with strong absences from those single-instrument sources; prepare-fsnew.py with
weak absences only).
"""
EXTRA_CAT = ['bongo', 'tuned percussion', 'banjo', 'mandolin', 'pitched vocal', 'shaker loop', 'synth hit', 'vocal shush']
# Run 9: below-bar tags that had no output yet (only run 9's staged sets and renders label them; prepare-run9.py).
EXTRA_CAT += ['reversed vocal', 'vocal pad', 'vocal phrase', 'rubbery bass', 'vocal harmony']
# Run 9, after the 2026-10-10 licence change: AudioSet's 'Steel guitar, slide guitar' clips give steel guitar data.
EXTRA_CAT += ['steel guitar']

# Run 9: the below-bar tags of reports/training-data-all-tags-2026-10-10.md that the tagger trains (every one except the
# nine rule-based timbre tags; steel guitar joined once AudioSet was allowed). An item marked weakAll='run9' (prepare-run9.py)
# counts every one of these it does not list as a weak absence, which keeps run 9's json small.
RUN9_TAGS = [
    '808 bass', 'acid bass', 'acid synth', 'air horn', 'animal sound', 'atmospheric pad', 'banjo', 'bass growl',
    'bass guitar', 'bass hit', 'bass pluck', 'bassoon', 'bell', 'bell synth', 'bird ambience', 'bitcrushed',
    'bongo', 'brass synth', 'breakbeat', 'breath', 'bright', 'cajon', 'cello', 'chiptune synth',
    'choir', 'chops', 'chorused', 'clap', 'clarinet', 'clave', 'closed hi-hat', 'conga',
    'crash cymbal', 'cymbal', 'dark', 'distorted', 'double bass', 'downlifter', 'drum fill', 'drum loop',
    'dry', 'echoing', 'electric piano', 'environmental sound', 'falling', 'filter sweep', 'filtered', 'finger snap',
    'flanged', 'flute', 'fm synth', 'foghorn bass', 'foley', 'foley hit', 'gliding', 'glitch effect',
    'glockenspiel', 'gong', 'hand percussion', 'hi-hat', 'hi-hat loop', 'horn', 'impact', 'kick',
    'laser', 'machine ambience', 'mandolin', 'marimba', 'noise', 'noise sweep', 'oboe', 'open hi-hat',
    'organ synth', 'percussion', 'percussion hit', 'percussion loop', 'pitched vocal', 'plucked', 'rain ambience', 'record stop',
    'reese bass', 'reverberant', 'reverse cymbal', 'reverse impact', 'reversed vocal', 'rhythmic', 'rimshot', 'riser',
    'rising', 'rolling', 'rubbery bass', 'saturated', 'shaker', 'shaker loop', 'sitar', 'snare',
    'snare roll', 'sound effect', 'spoken phrase', 'staccato', 'static noise', 'steel drum', 'string synth', 'stutter effect',
    'sub drop', 'supersaw', 'sustained', 'syncopated', 'synth arpeggio', 'synth bass', 'synth chord', 'synth drone',
    'synth hit', 'synth lead', 'synth pluck', 'synth sequence', 'synth stab', 'synthesizer', 'tabla', 'tambourine',
    'texture', 'tom', 'triangle', 'trombone', 'trumpet', 'tuba', 'tuned percussion', 'turntable',
    'vibraphone', 'vinyl crackle', 'viola', 'vocal breath', 'vocal chops', 'vocal gasp', 'vocal harmony', 'vocal hum',
    'vocal pad', 'vocal phrase', 'vocal scream', 'vocal shout', 'vocal shush', 'vocal vowel', 'vocal-like synth', 'vocoder vocal',
    'voice', 'water ambience', 'waterphone', 'whistle', 'whoosh', 'wind ambience', 'wobble bass', 'woodblock',
    'xylophone', 'steel guitar',
]

