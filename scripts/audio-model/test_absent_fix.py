"""Offline checks for train.py --absent-fix (absent_fix.py): only weak absences change, and only as listed."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


class AbsentFixTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('absent_fix_test_subject', Path(__file__).with_name('absent_fix.py'))
        self.fix = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.fix)
        fd, self.path = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        self.addCleanup(os.remove, self.path)
        json.dump({'drop': {'a': ['mandolin', 'banjo', 'guitar', 'harp'], 'b': ['oboe']},
                   'add': {'a': ['bongo', 'banjo'], 'c': ['sitar']}}, open(self.path, 'w'))
        self.assertEqual(self.fix.load(self.path), (2, 2))

    def test_weak_absences_only(self):
        labels = {'cat:guitar': 1.0, 'cat:mandolin': 0.0, 'cat:banjo': 0.0, 'cat:bongo': 0.0, 'cat:harp': 0.0}
        weak = {'cat:mandolin', 'cat:banjo', 'cat:bongo'}   # harp is an outright absence, guitar is present
        out = self.fix.edits('a', labels, weak)
        self.assertEqual(out, {'cat:mandolin': (0.0, 0.0), 'cat:banjo': (1.0, 1.0), 'cat:bongo': (1.0, 1.0)})
        self.assertEqual(labels['cat:mandolin'], 0.0)   # the inputs are only read
        self.assertEqual(weak, {'cat:mandolin', 'cat:banjo', 'cat:bongo'})

    def test_unlisted_item_and_off_by_default(self):
        self.assertEqual(self.fix.edits('zzz', {'cat:oboe': 0.0}, {'cat:oboe'}), {})
        self.fix.FIX.update(drop={}, add={})
        self.assertEqual(self.fix.edits('b', {'cat:oboe': 0.0}, {'cat:oboe'}), {})


if __name__ == '__main__':
    unittest.main()
