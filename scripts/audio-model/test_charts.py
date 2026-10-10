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


if __name__ == '__main__':
    unittest.main()
