"""Assistant judgement from clip TITLES ONLY (the user asked for it; nobody listened). For each queued clip:
yes / no / unsure for the one label it was queued for. Saved with provenance 'assistant title judgement',
never as a human confirmation, so the review tool and learned.json examples are untouched.
Usage: title-labels.py <review dir>"""
import json, re, sys
D = sys.argv[1]; items = json.load(open(f'{D}/manifest.json'))['items']
has = lambda t, p: re.search(p, t, re.I) is not None
def judge(label, t):
    if label == 'synth bass':
        if has(t, r'lead|pad|drone|beat|transmitter|space chase|sample \d'): return 'no'
        if has(t, r'synth bass|bassline|bass line|psytrance bass|analog synth bass|^bass\.wav$'): return 'yes'
        return 'unsure'
    if label == 'synth stab':
        if has(t, r'kick|drum|snare|laser|zap|whoosh|stabbing|clicker|hit / land|remix|stutter'): return 'no'
        if has(t, r'stab|chord|chung|donk'): return 'yes'
        return 'unsure'
    if label == 'supersaw':
        if has(t, r'trumpet|flute|organ|violin|plucked|chiptone|sid_|progressivesid|synth bass|uplifter|reese|arpeggio|werkstatt'): return 'no'
        if has(t, r'super ?saw|hoover|jp-80\d0|detuned_saw'): return 'yes'
        return 'unsure'
    if label == 'bass pluck':
        if has(t, r'808|acid|percussive hit|bassdrum|sustained|sawnod'): return 'no'
        return 'unsure'
    if label == 'shaker loop':
        if has(t, r'one shot|one hand shot|^shaker \d|wire spool|bolts|seedm|tambourine'): return 'no'
        if has(t, r'shakersal'): return 'unsure'
        if has(t, r'shak|xique|sekere|ganz') and has(t, r'loop|16th|4x4|bpm|groove|shakers'): return 'yes'
        return 'unsure'
    if label == 'rising':
        if has(t, r'gated|piffing|zither|whoosh'): return 'unsure'
        if has(t, r'ris|rise|rizee|charg|takeoff|climax|sweep|space'): return 'yes'
        return 'unsure'
    if label == 'syncopated':
        if has(t, r'swing|2 step|break|groove|walkthisway|tribal'): return 'yes'
        return 'unsure'
    return 'unsure'
out = []
for i in items:
    label = i['folder'].rsplit(' (', 1)[0]
    out.append({'id': i['id'], 'title': i['title'], 'label': label, 'decision': judge(label, i['title']), 'provenance': 'assistant title judgement (not listened to)'})
json.dump({'kind': 'title-labels-v1', 'note': 'Judged from titles only; not a listening check.', 'labels': out}, open(f'{D}/title-labels.json', 'w'), indent=1)
from collections import Counter
c = Counter((o['label'], o['decision']) for o in out)
for l in dict.fromkeys(o['label'] for o in out): print(f"{l:<12} yes {c[(l,'yes')]:>3}  no {c[(l,'no')]:>3}  unsure {c[(l,'unsure')]:>3}")
