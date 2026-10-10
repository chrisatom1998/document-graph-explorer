"""Synthetic regressions: python3 -I scripts/licensed-pilot/test_short_clip_head.py."""
import hashlib
import json
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent

class ShortClipHeadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'public/sound-model').mkdir(parents=True)
        rng = random.Random(7)
        self.mean = [rng.uniform(-.1, .1) for _ in range(512)]
        self.std = [rng.uniform(.01, .2) for _ in range(512)]
        other = {'group': 'source', 'label': 'piano', 'weights': [0.0] * 512, 'bias': 0.0, 'threshold': .6}
        old = {'group': 'source', 'label': 'bass guitar', 'weights': [1.0] * 512, 'bias': 0.0, 'threshold': .9}
        self.model = {'version': 1, 'kind': 'short-clip-heads', 'revision': 'r', 'blocks': ['clapRepeat'], 'maxSeconds': 2.25,
                      'mean': self.mean, 'std': self.std, 'heads': [other, old]}
        (self.root / 'public/sound-model/short-clip.json').write_text(json.dumps(self.model, separators=(',', ':')))
        (self.root / 'public/sound-model/manifest.json').write_text(json.dumps({'sha256': {'short-clip.json': 'old'}}, indent=2) + '\n')
        self.head = {'group': 'source', 'label': 'bass guitar', 'weights': [rng.uniform(-1, 1) for _ in range(512)], 'bias': -.3, 'threshold': .77}
        (self.root / 'heads.json').write_text(json.dumps({'heads': [self.head]}))

    def apply(self):
        return subprocess.run([sys.executable, '-I', str(SCRIPTS / 'apply_short_clip_head.py'), 'heads.json', 'bass guitar', 'tag'],
                              cwd=self.root, capture_output=True, text=True)

    def test_converted_head_scores_like_the_pilot_head(self):
        result = self.apply()
        self.assertEqual(result.returncode, 0, result.stderr)
        body = (self.root / 'public/sound-model/short-clip.json').read_text()
        model = json.loads(body)
        heads = {h['label']: h for h in model['heads']}
        self.assertEqual([h['label'] for h in model['heads']], ['piano', 'bass guitar'])
        self.assertEqual(heads['bass guitar']['threshold'], .77)
        self.assertEqual(model['revision'], 'r+tag')
        rng = random.Random(3)
        for _ in range(5):
            v = [rng.gauss(0, 1) for _ in range(512)]; n = sum(x * x for x in v) ** .5; u = [x / n for x in v]
            pilot = self.head['bias'] + sum(w * x for w, x in zip(self.head['weights'], u))
            x = [(a - m) / s for a, m, s in zip(u, self.mean, self.std)]
            shipped = heads['bass guitar']['bias'] + sum(w * y for w, y in zip(heads['bass guitar']['weights'], x))
            self.assertAlmostEqual(pilot, shipped, places=9)
        manifest = json.loads((self.root / 'public/sound-model/manifest.json').read_text())
        self.assertEqual(manifest['sha256']['short-clip.json'], hashlib.sha256(body.encode()).hexdigest())

    def test_refuses_non_finite_weights_and_leaves_files_alone(self):
        before = (self.root / 'public/sound-model/short-clip.json').read_text()
        (self.root / 'heads.json').write_text(json.dumps({'heads': [{**self.head, 'weights': [float('inf')] + self.head['weights'][1:]}]}))
        self.assertNotEqual(self.apply().returncode, 0)
        self.assertEqual((self.root / 'public/sound-model/short-clip.json').read_text(), before)
        self.assertEqual(json.loads((self.root / 'public/sound-model/manifest.json').read_text())['sha256']['short-clip.json'], 'old')

    def test_refuses_other_blocks(self):
        self.model['blocks'] = ['clapRepeat', 'event']
        (self.root / 'public/sound-model/short-clip.json').write_text(json.dumps(self.model))
        self.assertNotEqual(self.apply().returncode, 0)

if __name__ == '__main__':
    unittest.main()
