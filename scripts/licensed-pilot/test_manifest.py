"""Synthetic damaged-file regression: python3 -I scripts/licensed-pilot/test_manifest.py."""
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name('build_manifest.py')

class ManifestTests(unittest.TestCase):
    def check_rejection(self, damaged_path, partial=False, all_damaged=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ['pkg/inventory', 'pkg/instruments-environment', 'pkg/synth-vocal', 'pkg/effects',
                         'dl/karoryfer/repo/Samples', 'dl/x/kenney-impact/Audio', 'dl/x/kenney-scifi/Audio',
                         'dl/x/rubberduck50', 'dl/x/rubberduck100']:
                (root / name).mkdir(parents=True)
            (root / 'pkg/inventory/exclusion-manifest.json').write_text(json.dumps({'sets': {
                'audioSha256': [], 'sourceAudioSha256': [], 'sourceMembers': [], 'freesoundUploadersCasefold': []}}))
            (root / 'pkg/instruments-environment/new_source_shortlist.csv').write_text('source\n')
            (root / 'pkg/synth-vocal/file_manifest.csv').write_text('path\n')
            (root / 'pkg/effects/manifest.json').write_text(json.dumps({'freesound_examples': [], 'existing_dataset_archives': []}))
            (root / damaged_path).write_bytes(b'broken')
            if not all_damaged:
                (root / 'dl/x/rubberduck50/success.ogg').write_bytes(b'synthetic')
            runner = '''import runpy, subprocess, sys
from unittest.mock import patch
import numpy as np
script, damaged, partial, *args = sys.argv[1:]
sys.argv = [script, *args]
def decode(args, **kwargs):
    raw = (np.sin(np.arange(16000) * .1) * 10000).astype(np.int16).tobytes()
    if damaged in str(args): return subprocess.CompletedProcess(args, 1, raw if partial == 'True' else b'', b'damaged')
    return subprocess.CompletedProcess(args, 0, raw, b'')
with patch('subprocess.run', side_effect=decode): runpy.run_path(script, run_name='__main__')
'''
            result = subprocess.run([sys.executable, '-I', '-c', runner, str(SCRIPT), damaged_path, str(partial), 'pkg', 'dl', 'out'], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            with (root / 'out/accepted.csv').open() as f:
                accepted = list(csv.DictReader(f))
            with (root / 'out/rejected.csv').open() as f:
                rejected = list(csv.DictReader(f))
            self.assertEqual(len(accepted), 0 if all_damaged else 1)
            self.assertEqual(len(rejected), 1)
            self.assertIn('undecodable', rejected[0]['reject_reason'])

    def test_undecodable_positives_do_not_abort_other_candidates(self):
        for path in ['dl/karoryfer/repo/Samples/big_little_pluck_c2_f_rr1.wav',
                     'dl/x/kenney-impact/Audio/impactWood_001.ogg',
                     'dl/x/kenney-scifi/Audio/laserSmall_001.ogg']:
            with self.subTest(path=path):
                self.check_rejection(path)

    def test_failed_decode_with_partial_pcm_is_rejected(self):
        self.check_rejection('dl/x/kenney-scifi/Audio/laserSmall_001.ogg', partial=True)

    def test_all_candidates_rejected_still_writes_csvs(self):
        self.check_rejection('dl/karoryfer/repo/Samples/big_little_pluck_c2_f_rr1.wav', all_damaged=True)

if __name__ == '__main__': unittest.main()
