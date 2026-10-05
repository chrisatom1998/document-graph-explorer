"""TRAINING-ONLY short-clip items from Surge preset renders (CC BY 4.0, Zenodo 4677097).

Every render is a Surge synthesizer note, so source:synthesizer is a fact of how the audio was made.
Role labels (bass hit / synth hit) come from the Surge library's own patch category, a curated
creator category, and are used only to fit models; they never enter the benchmark.
Notes: first 1.0 or 2.0 s of two notes per preset, 10 ms fade-out (same treatment as benchmark NSynth notes).
"""
import json, os, re, hashlib, subprocess

D = '/Users/chrisjohnson/Documents/Media/audio-datasets/surge-presets/x/surge'
W = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips'
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()
CATS = ['Leads', 'Lead', 'Basses', 'Bass', 'Plucks', 'Pads', 'Atmospheres', 'Sequences', 'Chords', 'Brass', 'Keys', 'Organs', 'Arps', 'Percussion', 'Sound', 'FX', 'Vocoder', 'Pad', 'Pluck']
ROLE_ABSENT = ['role:kick', 'role:snare', 'role:hi-hat', 'role:cymbal', 'role:clap', 'role:finger snap', 'role:tambourine', 'role:cowbell', 'role:shaker',
               'role:vinyl scratch', 'role:vocal one-shot', 'role:beatbox', 'source:voice', 'source:guitar', 'source:bass guitar', 'source:piano']
items = []
for preset in sorted(os.listdir(D)):
    cat = next((c for c in re.split(r'[-_ ]', preset) if c in CATS), None)
    if cat is None: continue
    notes = sorted(n for n in os.listdir(f'{D}/{preset}') if n.endswith('.ogg'))
    for note in sorted(notes, key=lambda n: h('surge-pick', preset, n))[:2]:
        iid = 'sc-' + h('surge', preset, note)[:16]
        secs = 1.0 if int(h('len', preset, note)[:8], 16) % 2 else 2.0
        out = f'{W}/train-audio/{iid}.wav'
        if not os.path.exists(out):
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', f'{D}/{preset}/{note}', '-t', str(secs), '-af', f'afade=t=out:st={secs - .01}:d=0.01',
                            '-ac', '1', '-c:a', 'pcm_s16le', '-y', out], check=True)
        t = {'source:synthesizer': 'present'}
        drumlike = cat in ('Percussion', 'Sound', 'FX')
        if not drumlike:
            for k in ROLE_ABSENT: t[k] = 'absent'
            t['role:percussion hit'] = t['source:drums'] = t['role:impact'] = t['role:whoosh'] = 'absent'
        if cat == 'Vocoder': t.pop('role:vocal one-shot', None); t.pop('source:voice', None)
        if cat in ('Basses', 'Bass'): t['role:bass hit'] = 'present'
        elif cat in ('Leads', 'Lead', 'Plucks', 'Pluck', 'Keys', 'Pads', 'Pad', 'Atmospheres', 'Chords', 'Organs', 'Brass'): t['role:bass hit'] = 'absent'
        if cat in ('Leads', 'Lead', 'Plucks', 'Pluck', 'Keys', 'Basses', 'Bass', 'Chords', 'Organs', 'Brass'): t['role:synth hit'] = 'present'
        if cat in ('Sequences', 'Arps'): t['role:loop'] = 'present'
        elif not drumlike: t['role:loop'] = 'absent'
        items.append({'id': iid, 'groups': {'original': f'surge:{preset}', 'artist': f'surge:{preset}', 'pack': f'surge:{preset}', 'sampleFamily': f'surge:{preset}'},
                      'reviews': [{'dimension': k.split(':')[0], 'label': k.split(':', 1)[1], 'state': v} for k, v in sorted(t.items())],
                      'meta': {'dataset': 'surge', 'category': cat, 'preset': preset, 'note': note, 'durationSeconds': secs,
                               'labelBasis': 'synthesizer = how the audio was made; roles = Surge patch category (training only)'}})
json.dump({'items': items}, open(f'{W}/train-items-surge.json', 'w'))
json.dump([{'id': i['id'], 'path': f"{W}/train-audio/{i['id']}.wav"} for i in items], open(f'{W}/feature-list-surge.json', 'w'))
print(len(items), 'surge training clips')
