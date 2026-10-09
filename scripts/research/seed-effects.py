"""Build construction-labelled effect controls from the committed Iowa fixtures.

Usage: python scripts/research/seed-effects.py <new output directory>
The labels describe applied processors, not a human judgement of audibility.
"""
import json
from pathlib import Path
import subprocess
import sys

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=False)
repo = Path(__file__).resolve().parents[2]
effects = {'dry': 'anull', 'delay': 'aecho=0.8:0.9:120|250:0.45|0.3',
           'distortion': 'volume=10,asoftclip=type=hard:threshold=0.2,volume=0.1',
           'filter': 'lowpass=f=800:p=2'}
sources = []
for instrument, name in [('flute', 'iowa-flute-first8s.wav'), ('marimba', 'iowa-marimba-C7.wav')]:
    original = repo / 'src/audio/sourceMatching/testfixtures' / name
    for effect, processor in effects.items():
        target = out / f'{instrument}-{effect}.wav'
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(original), '-af', processor,
                        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(target)], check=True)
        tags = {f'effect:{label}': int(label == effect) for label in effects if label != 'dry'}
        sources.append({'id': f'{instrument}-{effect}', 'group': f'iowa-{instrument}', 'path': str(target),
                        'referenceKind': 'constructed-effect-diagnostic',
                        'truthByDuration': {str(d): {'tags': tags} for d in (1, 2, 6)},
                        'rights': {'evaluationAllowed': True, 'basis': 'Iowa MIS unrestricted project-use permission; committed fixture attribution.'},
                        'provenance': {'fixture': name, 'url': 'https://theremin.music.uiowa.edu/MIS.html',
                                       'processor': processor, 'ffmpegVersion': subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0],
                                       'note': 'Applied-effect identity only. Not perceptual truth; two source instruments.'}})
(out / 'inventory.json').write_text(json.dumps({'durations': [1, 2, 6], 'sources': sources}, indent=2) + '\n')
