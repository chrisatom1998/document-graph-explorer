"""Turn a SoundCloud track's own words (title, description, tags, genre) into instrument labels.

The 11 classes are the ones every DGE full-mix benchmark scores (scripts/mixed-music/score.mjs). Rules, fixed before any
audio was analysed:
- present: the track's text names the instrument (not inside a genre name such as "drum and bass", and not negated
  such as "no vocals" / "without drums").
- absent: the text negates it; or, for voice, the track calls itself instrumental and names no vocals; or the track
  lists its instruments (3+ different classes named, or an "instruments:" style line) and leaves out one of the
  classes people reliably list when they play them (piano, guitar, violin, saxophone, trumpet, organ).
- otherwise unknown: never scored. Drums, bass, synthesizer and cymbals are almost always in electronic tracks without
  being mentioned, so leaving them out of a list is not taken as absence.
Run with --selftest to check the rules on hand-written examples.
"""
import re, sys

CLASSES = ['drums', 'voice', 'synthesizer', 'piano', 'guitar', 'bass', 'cymbals', 'organ', 'violin', 'trumpet', 'saxophone']
LISTED_WHEN_PLAYED = {'piano', 'guitar', 'violin', 'saxophone', 'trumpet', 'organ'}

# Genre and idiom phrases whose instrument word does not say the instrument plays. Removed before matching.
GENRE_PHRASES = [
    r"drum\s*(?:and|&|n|'n'|’n’|\+)\s*bass", r'drum\s*n\s*bass', r'\bdnb\b', r'\bd&b\b', r'drumstep', r'drum\s*core',
    r'future\s*bass', r'bass\s*house', r'bass\s*music', r'\bubass\b', r'synth\s*-?\s*wave', r'synth\s*-?\s*pop',
    r'synth\s*-?\s*punk', r'dark\s*synth', r'guitar\s*hero', r'air\s*guitar', r'organic', r'piano\s*man\b',
    r'beat\s*tape', r'bass\s*boost(?:ed)?', r'hip\s*-?\s*hop\s*(?:&|and)\s*rap', r'rap\s*(?:instrumentals?|beats?)',
    r'beats?\s*for\s*rap(?:pers)?', r'rhodes\s*university',
]
TERMS = {
    'drums': [r'drums?', r'drum\s*kits?', r'drum\s*machines?', r'drummer', r'drumming', r'breakbeats?', r'\btr-?(?:808|909)\b'],
    'voice': [r'vocals?', r'vocalist', r'voices?', r'vox', r'singing', r'singer', r'sung', r'lyrics?', r'rapp(?:ers?|ing)', r'a\s*cappella', r'acapella', r'choir'],
    'synthesizer': [r'synths?', r'synthesi[sz]ers?', r'moog', r'arp\s*odyssey', r'juno-?\d*', r'prophet-?\d+', r'serum', r'sylenth1?', r'modular'],
    'piano': [r'pianos?', r'pianist', r'rhodes', r'electric\s*piano', r'wurlitzer', r'grand\s*piano'],
    'guitar': [r'guitars?', r'guitarist', r'stratocaster', r'telecaster', r'les\s*paul'],
    'bass': [r'bass\s*guitar', r'bassist', r'double\s*bass', r'upright\s*bass', r'electric\s*bass', r'slap\s*bass', r'bass\s*lines?', r'basslines?', r'sub\s*-?\s*bass', r'basses', r'bass'],
    'cymbals': [r'cymbals?', r'hi\s*-?\s*hats?', r'hihats?', r'ride\s*cymbal', r'crash\s*cymbal'],
    'organ': [r'organs?', r'hammond', r'organist'],
    'violin': [r'violins?', r'violinist', r'fiddles?'],
    'trumpet': [r'trumpets?', r'trumpeter', r'flugelhorn'],
    'saxophone': [r'sax(?:es)?', r'saxophones?', r'saxophonist'],
}
# "Bass guitar" is bass, not guitar.
NOT_GUITAR = re.compile(r'bass\s*guitars?', re.I)
# Only a few filler words may sit between the negation and the instrument ("no copyright piano music" is not negated).
NEGATION = r'(?:\bno\b|\bwithout\b|\bminus\b|\bsans\b|\bzero\b|\bnon-?)\s*(?:(?:any|real|live|lead|main|more|heavy|loud|the|a)\s+){0,2}'
LIST_LINE = re.compile(r'\b(?:instruments?|instrumentation|played\s+on|line-?\s*up|musicians?)\s*[:\-–]', re.I)
INSTRUMENTAL = re.compile(r'\binstrumentals?\b|\bno\s+vocals?\b|\bwithout\s+vocals?\b|\bvocal-?\s*free\b', re.I)

def _pattern(terms):
    return re.compile(r'(?<![\w-])(?:' + '|'.join(terms) + r')(?![\w-])', re.I)

PATTERNS = {c: _pattern(t) for c, t in TERMS.items()}
NEGATED = {c: re.compile(NEGATION + r'(?:' + '|'.join(t) + r')(?![\w-])', re.I) for c, t in TERMS.items()}

def clean(text):
    text = re.sub(r'https?://\S+|www\.\S+|@\w+|#', ' ', text)
    for phrase in GENRE_PHRASES:
        text = re.sub(phrase, ' ', text, flags=re.I)
    return text

def track_text(track):
    tags = re.findall(r'"([^"]+)"|(\S+)', track.get('tag_list') or '')
    tags = [a or b for a, b in tags]
    return '\n'.join([track.get('title') or '', track.get('description') or '', track.get('genre') or '', ' , '.join(tags)])

def labels_from_text(raw):
    """Returns ({class: 'present'|'absent'}, evidence) for one track's text."""
    text = clean(raw)
    negated = {c for c, p in NEGATED.items() if p.search(text)}
    present, evidence = set(), {}
    for c, p in PATTERNS.items():
        scan = NOT_GUITAR.sub(' ', text) if c == 'guitar' else text
        # Strip negated mentions before looking for positive ones.
        scan = NEGATED[c].sub(' ', scan)
        m = p.search(scan)
        if m:
            present.add(c); evidence[c] = m.group(0)
    out = {c: 'present' for c in present}
    for c in negated - present:
        out[c] = 'absent'; evidence[c] = 'negated'
    if 'voice' not in present and INSTRUMENTAL.search(raw):
        out['voice'] = 'absent'; evidence['voice'] = 'instrumental'
    listing = len(present) >= 3 or bool(LIST_LINE.search(raw))
    if listing:
        for c in LISTED_WHEN_PLAYED - present - set(out):
            out[c] = 'absent'; evidence[c] = 'left out of instrument list'
    return out, evidence, listing

def _selftest():
    cases = [
        ('Deep house with live sax and Rhodes', {'saxophone': 'present', 'piano': 'present'}),
        ('Drum and bass roller, no vocals', {'voice': 'absent'}),
        ('Future bass anthem | synthwave', {}),
        ('Instruments: guitar, bass guitar, drums, organ', {'guitar': 'present', 'bass': 'present', 'drums': 'present', 'organ': 'present',
                                                         'piano': 'absent', 'violin': 'absent', 'saxophone': 'absent', 'trumpet': 'absent'}),
        ('Lofi beat (instrumental) with piano and vinyl crackle', {'piano': 'present', 'voice': 'absent'}),
        ('Instrumental version, vocals by Ana on the original', {'voice': 'present'}),
        ('Techno track without drums, just synths', {'drums': 'absent', 'synthesizer': 'present'}),
        ('organic house', {}),
        ('Bass guitar groove', {'bass': 'present'}),
        ('A hi-hat heavy trap beat', {'cymbals': 'present'}),
        ('Free download, no copyright piano music', {'piano': 'present'}),
        ('Ambient pads with no real drums', {'drums': 'absent'}),
        ('Hard trap beat (rap instrumental)\nHip-hop & Rap', {'voice': 'absent'}),
        ('Massive drop', {}),
    ]
    bad = 0
    for text, want in cases:
        got = labels_from_text(text)[0]
        if got != want:
            bad += 1; print(f'FAIL {text!r}: got {got}, want {want}')
    print(f'{len(cases) - bad}/{len(cases)} label rule examples pass')
    sys.exit(1 if bad else 0)

if __name__ == '__main__' and '--selftest' in sys.argv:
    _selftest()
