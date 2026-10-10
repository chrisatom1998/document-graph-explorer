"""Synthetic regressions: python3 -I scripts/licensed-pilot/test_scoring.py."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent

class ScoringTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.hold = {'labels': ['laser'], 'items': [
            {'id': 'positive', 'path': 'positive.wav', 'short': True, 'labels': {'laser': 1}},
            {'id': 'negative', 'path': 'negative.wav', 'short': True, 'labels': {'laser': 0}}]}
        self.write('holdout.json', self.hold)
        self.lock()
        self.write('heads.json', {'heads': [{'label': 'laser', 'weights': [1, 0], 'bias': 0, 'threshold': .5}]})
        self.write('tags.json', [{'file': x['id'] + '.wav', 'status': 'complete', 'tags': []} for x in self.hold['items']])

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def lock(self):
        (self.root / 'holdout.lock').write_text(hashlib.sha256((self.root / 'holdout.json').read_bytes()).hexdigest() + '  holdout.json\n')

    def embeddings(self, probabilities=(.504, .503)):
        lines = []
        for row, p in zip(self.hold['items'], probabilities):
            logit = math.log(p / (1 - p))
            lines.append(json.dumps({'id': row['id'], 'embedding': [logit, math.sqrt(1 - logit * logit)]}))
        (self.root / 'emb.jsonl').write_text('\n'.join(lines))

    def run_script(self, script, *args):
        return subprocess.run([sys.executable, '-I', str(SCRIPTS / script), *map(str, args)], cwd=self.root, capture_output=True, text=True)

    def offline(self):
        return self.run_script('score_offline.py', 'holdout.json', 'emb.jsonl', 'heads.json', 'heads.json', 'out.json')

    def app(self):
        return self.run_script('score_app.py', 'holdout.json', 'out.json', 'tags.json')

    def assert_invalid(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.root / 'out.json').exists())

    def test_offline_rejects_missing_embedding(self):
        self.embeddings((.504,))
        self.assert_invalid(self.offline())

    def test_offline_allows_only_documented_tiny_missing_embeddings(self):
        self.embeddings((.504,))
        self.hold['items'][1]['seconds'] = .05
        self.hold['items'][1]['labels']['laser'] = 1
        self.write('holdout.json', self.hold)
        self.lock()
        result = self.offline()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.root / 'out.json').read_text())
        self.assertEqual(report['missing_ids'], ['negative'])
        score = report['heads']['pilot:laser']['short']
        self.assertEqual(score['support_pos'], 2)
        self.assertEqual(score['recall'], .5)
        self.assertEqual(score['skipped_positives'], 1)

    def test_offline_rejects_unexpected_missing_durations(self):
        self.embeddings((.504,))
        for seconds in [0, .1, 9, -1, float('nan'), float('inf'), True, '0.05', None]:
            with self.subTest(seconds=seconds):
                self.hold['items'][1]['seconds'] = seconds
                self.write('holdout.json', self.hold)
                self.lock()
                self.assert_invalid(self.offline())

    def test_ceiling_uses_observed_scores_between_grid_points(self):
        self.embeddings()
        result = self.offline()
        self.assertEqual(result.returncode, 0, result.stderr)
        score = json.loads((self.root / 'out.json').read_text())['heads']['pilot:laser']['short']
        self.assertEqual(score['ceiling_min_pr'], 1)
        self.assertAlmostEqual(score['ceiling_threshold'], .504)

    def test_ceiling_above_point_99(self):
        self.write('heads.json', {'heads': [{'label': 'laser', 'weights': [8, 0], 'bias': 0, 'threshold': .5}]})
        vectors = [{'id': 'positive', 'embedding': [1, 0]}, {'id': 'negative', 'embedding': [.7, math.sqrt(.51)]}]
        (self.root / 'emb.jsonl').write_text('\n'.join(map(json.dumps, vectors)))
        result = self.offline()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / 'out.json').read_text())['heads']['pilot:laser']['short']['ceiling_min_pr'], 1)

    def test_offline_rejects_changed_holdout(self):
        self.embeddings()
        self.hold['items'][0]['labels']['laser'] = 0
        self.write('holdout.json', self.hold)
        self.assert_invalid(self.offline())

    def test_app_rejects_changed_holdout(self):
        self.write('holdout.json', {**self.hold, 'changed': True})
        self.assert_invalid(self.app())

    def test_app_rejects_missing_result(self):
        self.write('tags.json', [])
        self.assert_invalid(self.app())

    def test_app_rejects_incomplete_result(self):
        self.write('tags.json', [{'file': x['id'] + '.wav', 'status': 'processing', 'tags': []} for x in self.hold['items']])
        self.assert_invalid(self.app())

    def test_app_preserves_complete_scoring(self):
        self.write('tags.json', [
            {'file': 'positive.wav', 'status': 'complete', 'tags': ['production:laser [likely] (maybe) 0.9']},
            {'file': 'negative.wav', 'status': 'complete', 'tags': []}])
        result = self.app()
        self.assertEqual(result.returncode, 0, result.stderr)
        score = json.loads((self.root / 'out.json').read_text())['labels']['laser']['short']
        self.assertEqual(score['shown']['recall'], 1)
        self.assertEqual(score['strict']['recall'], 0)

    def test_relative_dataset_symlinks_resolve(self):
        (self.root / 'dataset').mkdir()
        for row in self.hold['items']:
            (self.root / 'dataset' / row['path']).write_bytes(b'synthetic')
        # Exercise the exact preparation block without starting Chromium or invoking npm.
        script = (SCRIPTS / 'run_app.sh').read_text().split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]
        (self.root / 'out/audio').mkdir(parents=True)
        result = subprocess.run([sys.executable, '-I', '-', 'holdout.json', 'dataset', 'out'], input=script, cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'out/audio/positive.wav').read_bytes(), b'synthetic')

if __name__ == '__main__':
    unittest.main()
