"""Offline regression checks for optional chart cleanup and publication ordering."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import patch


class ChartsFinishTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('charts_test_subject', Path(__file__).with_name('charts.py'))
        self.charts = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.charts)
        self.finished = []
        self.trackio = types.SimpleNamespace(init=lambda **kwargs: None, log=lambda *args, **kwargs: None,
                                            finish=lambda: self.finished.append(True))
        self.modules = patch.dict(sys.modules, {'trackio': self.trackio})
        self.env = patch.dict(os.environ, {'TRACKIO_SPACE': 'offline-test/charts'})
        self.modules.start()
        self.env.start()
        self.addCleanup(self.modules.stop)
        self.addCleanup(self.env.stop)
        self.charts.start('offline-test', {})

    def test_busy_timeout_does_not_race_final_upload(self):
        entered, release, completed = threading.Event(), threading.Event(), threading.Event()
        writes = []

        def upload(doc):
            payload = json.loads(doc)
            if not payload['done']:
                entered.set()
                release.wait(5)
            writes.append(payload['done'])
            if not payload['done']:
                completed.set()

        self.charts._upload = upload
        self.charts._push()
        self.assertTrue(entered.wait(2))
        output = io.StringIO()
        try:
            with patch.object(self.charts.time, 'sleep'), contextlib.redirect_stdout(output):
                self.charts.finish()
            self.assertEqual(writes, [], 'Never publish a final file concurrently with an older upload')
            self.assertIn('final upload', output.getvalue())
            self.assertIn('timed out', output.getvalue())
            self.assertEqual(self.finished, [True])
        finally:
            release.set()
            self.assertTrue(completed.wait(2))

    def test_final_upload_follows_completed_background_upload(self):
        self.charts._mirror['busy'] = True
        writes = []
        self.charts._upload = lambda doc: writes.append(json.loads(doc)['done'])

        def complete_background(_):
            writes.append(False)
            self.charts._mirror['busy'] = False

        with patch.object(self.charts.time, 'sleep', side_effect=complete_background):
            self.charts.finish()
        self.assertEqual(writes, [False, True])
        self.assertEqual(self.finished, [True])

    def test_final_upload_wait_is_bounded(self):
        entered, release, completed = threading.Event(), threading.Event(), threading.Event()

        def upload(doc):
            self.assertTrue(json.loads(doc)['done'])
            entered.set()
            release.wait(5)
            completed.set()

        self.charts._upload = upload
        timeouts = []

        def no_wait(thread, timeout):
            timeouts.append(timeout)
            self.assertTrue(entered.wait(2))

        output = io.StringIO()
        try:
            with patch.object(threading.Thread, 'join', no_wait), contextlib.redirect_stdout(output):
                self.charts.finish()
            self.assertEqual(timeouts, [120])
            self.assertIn('publication is not confirmed', output.getvalue())
            self.assertEqual(self.finished, [True])
        finally:
            release.set()
            self.assertTrue(completed.wait(2))

    def test_final_upload_error_is_reported(self):
        def fail(doc):
            raise RuntimeError('offline')
        self.charts._upload = fail
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.charts.finish()
        self.assertIn('chart mirror final upload failed: offline', output.getvalue())
        self.assertEqual(self.finished, [True])

    def test_logging_error_still_finishes(self):
        def fail(*args, **kwargs):
            raise RuntimeError('offline')
        self.trackio.log = fail
        writes = []
        self.charts._upload = lambda doc: writes.append(json.loads(doc)['done'])
        self.charts.log({'loss': 1})
        self.charts.finish()
        self.assertEqual(writes, [True])
        self.assertEqual(self.finished, [True])


class ChartsSummaryTests(unittest.TestCase):
    def load(self, env, whoami=None):
        spec = importlib.util.spec_from_file_location('charts_summary_subject', Path(__file__).with_name('charts.py'))
        charts = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(charts)
        calls = {'init': [], 'log': [], 'finish': 0}
        trackio = types.SimpleNamespace(init=lambda **kw: calls['init'].append(kw), log=lambda v, step=None: calls['log'].append((v, step)),
                                        finish=lambda: calls.__setitem__('finish', calls['finish'] + 1))
        hub = types.SimpleNamespace(whoami=lambda: {'name': whoami or 'nobody'}, HfApi=lambda: types.SimpleNamespace(batch_bucket_files=lambda *a, **k: None))
        patches = [patch.dict(sys.modules, {'trackio': trackio, 'huggingface_hub': hub}), patch.dict(os.environ, env, clear=True)]
        for p in patches:
            p.start(); self.addCleanup(p.stop)
        return charts, calls

    def test_summary_is_off_without_space_or_token(self):
        charts, calls = self.load({})
        charts.summary('dj-effects', {}, {'heads trained': 3})
        self.assertEqual((calls['init'], calls['log'], calls['finish']), ([], [], 0))

    def test_summary_charts_one_finished_point_with_a_token(self):
        charts, calls = self.load({'HF_TOKEN': 'x'}, whoami='someone')
        with patch.object(charts, '_upload'):
            charts.summary('dj-effects', {}, {'heads trained': 3})
        self.assertEqual(calls['init'][0]['space_id'], 'someone/dge-training-charts')
        self.assertTrue(calls['init'][0]['name'].startswith('dj-effects-'))
        self.assertEqual(calls['log'], [({'epoch': 1.0, 'heads trained': 3.0}, 1)])
        self.assertEqual(calls['finish'], 1)

    def test_empty_space_opts_out(self):
        charts, calls = self.load({'HF_TOKEN': 'x', 'TRACKIO_SPACE': ''})
        charts.summary('dj-effects', {}, {'heads trained': 3})
        self.assertEqual(calls['init'], [])


if __name__ == '__main__':
    unittest.main()
