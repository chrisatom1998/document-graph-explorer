"""Uploader-word rules for the motion tags (Freesound title + tags), shared by the train-side tuning picks and the
held-out test candidates. H = the words say the tag plainly; M = plausible, needs ears (listen list).
Same matching style as datasets/test8-untested-tags/scripts/search.py."""
import hashlib, re

h8 = lambda s: int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)
synth_held = lambda u: h8('synth-fresh-up|freesound-user:' + u) % 5 == 0
dj_held = lambda u: h8('dj-effects|' + u) % 4 == 0
fs_test = lambda u: h8('dge-audio-model-freesound-test|' + u) % 10 == 0
test_uploader = lambda u: synth_held(u) or fs_test(u)                 # the pool test8 drew from
reserved_any = lambda u: synth_held(u) or dj_held(u) or fs_test(u)    # never train side

norm = lambda s: re.sub(r'[\s_\-\.]+', ' ', (s or '').lower())
def text(r): return norm(r['title']) + ' | ' + ' | '.join(norm(x) for x in (r['tags'] or []))
def has(r, *ws, field=None):
    s = ' ' + (field if field is not None else text(r)) + ' '
    return any(re.search(r'(?<![a-z0-9])' + w + r'(?![a-z0-9])', s) for w in ws)

DRUM = ('drums?', 'drum ?loop', 'beats?', 'percussion', 'kick', 'snare', 'hats?', 'hi ?hats?', 'breaks?', 'breakbeat', 'groove')
LOOP = ('loops?', 'looped', 'loopable', r'\d+ ?bpm', 'bpm')
NOT_MUSIC_ROLL = ('ball', 'balls', 'dice', 'marbles?', 'cart', 'wheels?', 'trolley', 'suitcase', r'skate\w*', 'thunder', 'rolling stones?',
                  'tyres?', 'tires?', 'barrel', 'bowling', 'roller', 'coaster', 'rock ?n ?roll', 'roll ?call', 'spring ?roll', 'paper', 'tape', 'film')
FALL_OBJECT = ('falls?', 'fallen', 'drop(ped|ping)?s?', 'rain', 'water', 'leaves', 'snow', 'objects?', 'debris', 'rocks?', 'body', 'crash')

RULES = {
    'rhythmic': dict(
        H=lambda r: has(r, *LOOP) and has(r, *DRUM) and not has(r, 'one ?shots?', 'single ?hit', r'ambien\w*', 'drone'),
        M=lambda r: has(r, 'rhythm', 'rhythmic', 'groove', 'pattern', 'ostinato', 'sequence') and not has(r, 'one ?shots?', 'heart ?beat', r'ambien\w*')),
    'syncopated': dict(
        H=lambda r: has(r, r'syncopat\w*'),
        M=lambda r: has(r, 'off ?beats?', 'breakbeats?', 'amen', 'shuffle', 'swing', 'skank', 'clave', 'dembow', 'funky') and has(r, *LOOP, *DRUM)),
    'sustained': dict(
        H=lambda r: has(r, 'sustained?', 'held note', 'long note', 'long tone', 'sustained note', 'sustained tone', 'sustain loop') and not has(r, 'pedal'),
        M=lambda r: has(r, 'drone', 'drones', 'pad', 'pads', 'long', 'held') and has(r, 'notes?', 'tones?', 'chords?', r'synth\w*', 'organ', 'strings?', 'drone') and not has(r, *DRUM)),
    'pulsing': dict(
        H=lambda r: has(r, 'pulsing', 'pulsating', r'pulsate\w*', 'tremolo', 'throbbing', 'throb') and not has(r, 'heart', 'heartbeat', 'pulse wave', 'pwm', 'mandolin', 'guitar'),
        M=lambda r: has(r, 'pulses?', 'gated', 'trance ?gate', r'side ?chain\w*', r'stutter\w*') and not has(r, 'heart', 'heartbeat', 'pulse wave', 'pwm', 'radar')),
    'swelling': dict(
        H=lambda r: has(r, 'swell', 'swells', 'swelling', 'crescendo', 'fade ?in', 'reverse ?cymbal') and not has(r, 'sea', 'ocean', 'waves?', 'water'),
        M=lambda r: has(r, 'risers?', 'rising', 'build ?up', 'uplifter', 'reversed?', 'backwards?') and has(r, 'cymbal', 'pad', r'synth\w*', 'strings?', 'noise', 'fx', 'swoosh', 'whoosh', 'chord')),
    'falling': dict(
        H=lambda r: has(r, 'downlifter', 'down ?lifter', r'pitch ?(down|drop|fall\w*)', 'falling (tone|pitch|synth|whistle|bomb|sweep)', 'descending (tone|pitch|synth|sweep|whistle|glissando)', 'down ?sweep', 'power ?down', 'tape ?stop', r'bomb ?(drop|fall\w*|whistle)'),
        M=lambda r: has(r, 'falling', r'descend\w*', 'downward', 'glissando', 'dive', 'slide ?down', 'drop') and has(r, 'tone', 'pitch', r'synth\w*', 'sweep', 'whistle', 'siren', 'laser', 'fx', 'sfx', 'bass', 'glissando') and not has(r, *FALL_OBJECT[2:])),
    'wobbling': dict(
        H=lambda r: has(r, r'wobbl\w*', 'wobble ?bass', 'wub', 'wubs', 'wub ?wub'),
        M=lambda r: has(r, 'lfo', 'warble', 'warbling', 'vibrato', 'wah', 'wah ?wah', 'wobbly', 'wavering') and not has(r, r'bird\w*')),
    'percussive': dict(
        H=lambda r: has(r, 'percussive', 'drum ?hits?', 'kick ?drum', 'snare ?(hit|drum)?', 'rim ?shot', 'clap', 'hand ?clap', 'woodblock', 'wood ?block', 'clave', 'rimshot', 'tom ?hit')
                    and has(r, 'one ?shots?', 'hits?', 'single', 'percussive', 'sample') and not has(r, *LOOP, 'roll', 'applause', 'crowd'),
        M=lambda r: has(r, 'knock', 'knocks', r'pluck\w*', 'stab', 'impact', 'thud', 'tap', 'taps', 'hit') and not has(r, *LOOP, 'roll', 'applause', 'crowd', r'reverse\w*', 'swell', 'drone')),
    'rolling': dict(
        H=lambda r: has(r, 'drum ?roll', 'snare ?roll', 'timpani ?roll', 'cymbal ?roll', 'tom ?roll', 'marimba ?roll', 'roll on (snare|cymbal|timpani|drum)', 'press ?roll', 'buzz ?roll') and not has(r, *NOT_MUSIC_ROLL),
        M=lambda r: has(r, 'rolls?', 'rolling', 'tremolo', 'trill') and has(r, 'drums?', 'snare', 'timpani', 'cymbal', 'marimba', 'xylophone', 'percussion', 'tambourine', 'shaker', 'mallet', 'bass ?line', 'dnb', 'drum ?and ?bass', 'tom') and not has(r, *NOT_MUSIC_ROLL)),
}
TAGS = list(RULES)
# Words that keep a clip out of the keyword-free negative pool (title, tags and the first 300 characters of the description).
NEG_FAMILY = (r'rhythm|syncop|sustain|drone|pad\b|puls|tremolo|throb|gate|sidechain|swell|crescendo|fade|rise|riser|rising|revers|backward|'
              r'fall|descend|downlift|pitch|sweep|dive|tape ?stop|power ?down|wobbl|wub|lfo|warbl|vibrato|wah|percuss|drum|kick|snare|clap|'
              r'\bhits?\b|knock|roll|trill|loop|bpm|beat|groove|pattern|sequence|bright|dark|music|song|synth|bass|chord|note|tone|instrument')
