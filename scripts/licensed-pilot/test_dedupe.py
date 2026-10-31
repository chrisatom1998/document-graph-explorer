"""Synthetic holdout-coverage regressions; no real holdout files or audio are read.

Run: python3 -m unittest discover -s scripts/licensed-pilot -p test_dedupe.py
"""
import contextlib
import csv
import hashlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings


SCRIPT = Path(__file__).with_name('dedupe.py')


class HoldoutEmbeddingCoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.hold = self.root / 'holdout.json'
        self.lock = self.root / 'holdout.lock'
        self.output = self.root / 'output'
        self.embeddings_path = self.root / 'embeddings.jsonl'
        self.manifest = self.root / 'train.csv'
        self.hold_items = [{'id': 'embedded', 'path': 'synthetic.wav', 'seconds': 1.0}]
        self.embeddings = {'embedded': [0, 0, 1], 'train': [1, 0, 0]}
        with self.manifest.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, ['id', 'fold_group', 'pcm16k_sha256'])
            writer.writeheader()
            writer.writerow({'id': 'train', 'fold_group': 'training-group', 'pcm16k_sha256': 'training-pcm'})

    def run_dedupe(self):
        blob = json.dumps({'items': self.hold_items}).encode()
        self.hold.write_bytes(blob)
        self.lock.write_text(hashlib.sha256(blob).hexdigest() + '  holdout.json\n')
        self.embeddings_path.write_text(''.join(
            json.dumps({'id': row_id, 'embedding': embedding}) + '\n'
            for row_id, embedding in self.embeddings.items()
        ))
        argv = [str(SCRIPT), str(self.hold), str(self.root), str(self.embeddings_path),
                str(self.output), str(self.manifest)]
        def fake_decode(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, stdout=b'synthetic PCM: ' + args[args.index('-i') + 1].encode())
        with patch.object(sys, 'argv', argv), patch.object(subprocess, 'run', side_effect=fake_decode) as decode:
            self.decode = decode
            with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
                warnings.simplefilter('ignore', ResourceWarning)
                runpy.run_path(str(SCRIPT), run_name='__main__')
        return json.loads((self.output / 'dedupe.json').read_text())

    def add_missing(self, seconds):
        self.hold_items.append({'id': 'unembedded', 'path': 'tiny.wav', 'seconds': seconds})

    def assert_rejected(self):
        with self.assertRaisesRegex(SystemExit, 'missing CLAP embeddings.*unembedded'):
            self.run_dedupe()
        self.decode.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_tiny_missing_holdout_embedding_keeps_pcm_check_and_disclosure(self):
        self.add_missing(0.099)
        report = self.run_dedupe()
        self.assertEqual(report['holdout_files_compared'], 2)
        self.assertEqual(report['holdout_embedded'], 1)
        self.assertEqual(report['holdout_not_embedded'], ['unembedded'])
        self.assertEqual(self.decode.call_count, 2)
        self.assertEqual(report['dropped'], [])
        with (self.output / 'train.csv').open() as stream:
            self.assertEqual([row['id'] for row in csv.DictReader(stream)], ['train'])

    def test_tiny_unembedded_holdout_still_excludes_exact_pcm_copy(self):
        self.add_missing(0.05)
        pcm = b'synthetic PCM: ' + str(self.root / 'tiny.wav').encode()
        with self.manifest.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, ['id', 'fold_group', 'pcm16k_sha256'])
            writer.writeheader()
            writer.writerow({'id': 'train', 'fold_group': 'training-group',
                             'pcm16k_sha256': hashlib.sha256(pcm).hexdigest()})
        report = self.run_dedupe()
        self.assertEqual(report['dropped'][0]['reason'], 'decoded audio identical to holdout unembedded')

    def test_missing_long_holdout_embedding_is_rejected(self):
        self.add_missing(9.0)
        self.assert_rejected()

    def test_exactly_point_one_seconds_is_not_a_tiny_exception(self):
        self.add_missing(0.1)
        self.assert_rejected()

    def test_missing_duration_is_rejected(self):
        self.hold_items.append({'id': 'unembedded', 'path': 'unknown.wav'})
        self.assert_rejected()

    def test_nonfinite_duration_is_rejected(self):
        for seconds in (float('nan'), float('inf'), float('-inf')):
            with self.subTest(seconds=seconds):
                self.hold_items = self.hold_items[:1]
                self.add_missing(seconds)
                self.assert_rejected()

    def test_invalid_duration_is_rejected(self):
        for seconds in (None, 'unknown', '0.05', True, False, [], {}, 0, -0.05):
            with self.subTest(seconds=seconds):
                self.hold_items = self.hold_items[:1]
                self.add_missing(seconds)
                self.assert_rejected()

    def test_missing_long_embedding_does_not_overwrite_existing_output(self):
        self.add_missing(9.0)
        self.output.mkdir()
        previous = self.output / 'train.csv'
        previous.write_bytes(b'previous output\n')
        with self.assertRaisesRegex(SystemExit, 'missing CLAP embeddings.*unembedded'):
            self.run_dedupe()
        self.decode.assert_not_called()
        self.assertEqual(previous.read_bytes(), b'previous output\n')
        self.assertEqual(list(self.output.iterdir()), [previous])

    def test_embedded_long_holdout_needs_no_tiny_exception(self):
        self.hold_items[0]['seconds'] = 9.0
        report = self.run_dedupe()
        self.assertEqual(report['holdout_not_embedded'], [])
        self.assertEqual(report['holdout_embedded'], 1)


if __name__ == '__main__':
    unittest.main()
