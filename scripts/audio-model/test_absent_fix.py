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

    def test_sure_absent_wins(self):
        json.dump({'add': {'a': ['bongo']}, 'drop': {'a': ['conga']}, 'absent': {'a': ['bongo', 'conga', 'guitar']}}, open(self.path, 'w'))
        self.fix.load(self.path)
        labels = {'cat:guitar': 1.0, 'cat:bongo': 0.0, 'cat:conga': 0.0}
        out = self.fix.edits('a', labels, {'cat:bongo', 'cat:conga'})
        self.assertEqual(out, {'cat:bongo': (0.0, 1.0), 'cat:conga': (0.0, 1.0)})   # the clip's own guitar stays present
        json.dump({'absent': {'a': ['oboe']}, 'add': {'a': ['oboe']}}, open(self.path, 'w'))
        self.fix.load(self.path)
        self.assertEqual(self.fix.edits('a', {}, set()), {'cat:oboe': (0.0, 1.0)})   # unscored tag: only a sure absence fills it

    def test_unlisted_item_and_off_by_default(self):
        self.assertEqual(self.fix.edits('zzz', {'cat:oboe': 0.0}, {'cat:oboe'}), {})
        self.fix.FIX.update(drop={}, add={}, absent={})
        self.assertEqual(self.fix.edits('b', {'cat:oboe': 0.0}, {'cat:oboe'}), {})

    def test_relabel_own_positives(self):
        json.dump({'wrong': {'freesound:1': ['ride cymbal', 'oboe']}, 'unsure': {'freesound:1': ['sub bass']},
                   'relabel_rules': [{'id': '^nsynth:flute_synthetic_', 'unsure': ['flute']}]}, open(self.path, 'w'))
        self.fix.load(self.path)
        labels = {'cat:ride cymbal': 1.0, 'cat:sub bass': 1.0, 'cat:oboe': 0.0, 'cat:kick': 1.0}
        weak = {'cat:oboe'}
        self.assertEqual(self.fix.relabel('freesound:1', labels, weak), 2)
        self.assertEqual(labels, {'cat:ride cymbal': 0.0, 'cat:oboe': 0.0, 'cat:kick': 1.0})   # wrong -> absent, unsure -> unknown
        self.assertEqual(weak, {'cat:oboe'})   # an absence that was already there stays as it was
        labels = {'cat:flute': 1.0, 'cat:synthesizer': 1.0}
        self.assertEqual(self.fix.relabel('nsynth:flute_synthetic_000-060-127', labels, set()), 1)
        self.assertEqual(labels, {'cat:synthesizer': 1.0})
        self.assertEqual(self.fix.relabel('nsynth:flute_acoustic_000-060-127', {'cat:flute': 1.0}, set()), 0)

    def test_rule_hard_negatives(self):
        json.dump({'relabel_rules': [{'id': '^nsynth:bass_synthetic_', 'absent': ['kick']}]}, open(self.path, 'w'))
        self.fix.load(self.path)
        labels, weak = {'cat:synth bass': 1.0}, set()
        self.assertEqual(self.fix.relabel('nsynth:bass_synthetic_001-030-100', labels, weak), 1)
        self.assertEqual(labels, {'cat:synth bass': 1.0, 'cat:kick': 0.0})
        labels, weak = {'cat:kick': 0.0}, {'cat:kick'}   # a weak absence becomes a sure one
        self.fix.relabel('nsynth:bass_synthetic_001-030-100', labels, weak)
        self.assertEqual((labels, weak), ({'cat:kick': 0.0}, set()))
        labels = {'cat:kick': 1.0}   # never against the clip's own positive
        self.assertEqual(self.fix.relabel('nsynth:bass_synthetic_001-030-100', labels, set()), 0)
        self.assertEqual(labels, {'cat:kick': 1.0})


if __name__ == '__main__':
    unittest.main()
