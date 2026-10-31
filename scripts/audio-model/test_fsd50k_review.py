"""Offline regression tests for PR195's review findings; no models or Hub downloads."""
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import fsd50k_extra


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CoverageTests(unittest.TestCase):
    def test_counts_relabels_but_excludes_validation(self):
        tag = 'cat:hand percussion'
        seen = []
        def load_source(name, mel, items, weight):
            seen.extend(items)
            return {'y': np.array([[it['labels'].get(tag, -1)] for it in items]),
                    'w': np.ones((len(items), 1))}
        train = types.SimpleNamespace(CLASSES=[tag], load_source=load_source)
        with tempfile.TemporaryDirectory() as d, patch.dict(sys.modules, {'train': train}):
            base = Path(d)
            items = [{'id': f'fsd50k:{i}', 'labels': {}} for i in range(101)]
            (base / 'fsd50k.json').write_text(json.dumps({'items': items}))
            (base / 'log.json').write_text(json.dumps({'val': {'fsd50k': ['fsd50k:100']}}))
            (base / 'thresholds.json').write_text('{}')
            coverage = load('coverage_review_test', 'coverage.py')
            with patch.object(fsd50k_extra, 'fsd50k_classes', return_value={str(i): {'Tabla'} for i in range(101)}), \
                 patch.object(sys, 'argv', ['coverage.py', d, f'fsd50k={d}']):
                coverage.main()
            row = next(r for r in json.loads((base / 'coverage.json').read_text()) if r['label'] == 'hand percussion')
            self.assertEqual(row['trainPositives'], 100)
            self.assertFalse(row['lowData'])
            self.assertEqual(len(seen), 100)
            self.assertNotIn('fsd50k:100', [it['id'] for it in seen])


class RefreshTests(unittest.TestCase):
    def test_refreshes_every_run_and_preserves_other_sets_and_thresholds(self):
        refresh = load('refresh_review_test', 'refresh-fsd50k-eval.py')
        calls = []
        with tempfile.TemporaryDirectory() as d:
            runs = [Path(d) / name for name in ('shipped', 'candidate')]
            for run in runs:
                run.mkdir()
                (run / 'log.json').write_text(json.dumps({'args': {'model': 'mn10_as'}}))
                (run / 'thresholds.json').write_text('{"frozen": true}')
                (run / 'eval.json').write_text(json.dumps({'eval-fsd50k': {'all': {'old': {}}}, 'other-set': {'unchanged': True}}))
            def runner(cmd, check):
                self.assertTrue(check)
                calls.append(cmd)
                if Path(cmd[1]).name == 'evaluate.py':
                    Path(cmd[4]).write_text(json.dumps({'eval-fsd50k': {'all': {'cat:hand percussion': {'positives': 177}}}}))
            refresh.refresh('/cache/eval-fsd50k', runs, runner=runner)
            self.assertEqual(len(calls), 4)
            for i, run in enumerate(runs):
                self.assertEqual(calls[2 * i][2], str(run / 'model.pt'))
                self.assertEqual(calls[2 * i + 1][3], str(run / 'thresholds.json'))
                self.assertEqual(calls[2 * i + 1][-1], '/cache/eval-fsd50k')
                report = json.loads((run / 'eval.json').read_text())
                self.assertEqual(report['other-set'], {'unchanged': True})
                self.assertEqual(report['eval-fsd50k']['all']['cat:hand percussion']['positives'], 177)
                self.assertNotIn('old', report['eval-fsd50k']['all'])
                self.assertEqual((run / 'thresholds.json').read_text(), '{"frozen": true}')

    def test_failed_evaluation_preserves_report_and_stops(self):
        refresh = load('refresh_failure_test', 'refresh-fsd50k-eval.py')
        with tempfile.TemporaryDirectory() as d:
            run = Path(d)
            (run / 'log.json').write_text(json.dumps({'args': {'model': 'mn10_as'}}))
            (run / 'eval.json').write_text('{"historical": true}')
            def runner(cmd, check):
                raise subprocess.CalledProcessError(1, cmd)
            with self.assertRaises(subprocess.CalledProcessError):
                refresh.refresh('/cache/eval-fsd50k', [run], runner=runner)
            self.assertEqual((run / 'eval.json').read_text(), '{"historical": true}')

    def test_job_normalizes_before_selection(self):
        job = (ROOT / 'hf-combine-job.sh').read_text()
        self.assertLess(job.index('python3 $S/refresh-fsd50k-eval.py'), job.index('python3 $S/combine.py'))


if __name__ == '__main__':
    unittest.main()
