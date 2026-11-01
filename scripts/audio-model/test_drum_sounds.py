"""Offline checks for the 2026-10-31 drums meaning (drum_sounds.py): any drum sound present counts drums present."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import drum_sounds
import fsd50k_extra


def load_train():
    """train.py with torch and EfficientAT stubbed out (only load_source is used)."""
    fake = types.ModuleType('torch'); fake.nn = types.ModuleType('torch.nn'); fake.nn.functional = types.ModuleType('torch.nn.functional')
    mn = types.ModuleType('models.mn.model'); mn.get_model = None
    mods = {'torch': fake, 'torch.nn': fake.nn, 'torch.nn.functional': fake.nn.functional,
            'models': types.ModuleType('models'), 'models.mn': types.ModuleType('models.mn'), 'models.mn.model': mn}
    with tempfile.TemporaryDirectory() as eat, patch.dict(sys.modules, mods), patch.dict(os.environ, {'EFFICIENTAT': eat}):
        spec = importlib.util.spec_from_file_location('train_drums_test', ROOT / 'train.py')
        train = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(train)
    return train


class ApplyTests(unittest.TestCase):
    def test_one_shot_beats_old_absent(self):
        for part in ('kick', 'snare', 'hi-hat', 'cymbal', 'crash cymbal', 'tabla'):
            labels, weak = {f'cat:{part}': 1.0, 'cat:drums': 0.0}, {'cat:drums'}
            self.assertTrue(drum_sounds.apply(labels, weak))
            self.assertEqual(labels['cat:drums'], 1.0)
            self.assertEqual(weak, set())   # full weight

    def test_strings_and_unchanged_cases(self):
        labels = {'cat:hi-hat': 'present', 'cat:drums': 'absent'}
        self.assertTrue(drum_sounds.apply(labels)); self.assertEqual(labels['cat:drums'], 'present')
        for labels in ({'cat:clap': 1.0, 'cat:drums': 0.0}, {'cat:kick': 0.0, 'cat:drums': 0.0}, {'cat:snare': 1.0, 'cat:drums': 1.0}, {}):
            before = dict(labels)
            self.assertFalse(drum_sounds.apply(labels)); self.assertEqual(labels, before)   # clap is not a drum; absences add nothing

    def test_apply_items_updates_weak_list(self):
        items = [{'labels': {'cat:tom': 1.0, 'cat:drums': 0.0}, 'weakAbsent': ['cat:drums', 'cat:bell']}, {'labels': {'cat:bell': 1.0}}]
        self.assertEqual(drum_sounds.apply_items(items), 1)
        self.assertEqual(items[0]['weakAbsent'], ['cat:bell']); self.assertNotIn('cat:drums', items[1]['labels'])

    def test_every_drum_sound_is_a_tagger_class(self):
        train = load_train()
        self.assertTrue({f'cat:{t}' for t in drum_sounds.DRUM_SOUNDS + ('drums',)} <= set(train.CLASSES))

    def test_no_prepare_script_imports_it(self):
        # labelmap.py / prepare*.py and the modules they import are prep-cache keys (hf-job.sh, prep-cache.py): keep the rule out.
        for p in ROOT.glob('prepare*.py'):
            src = p.read_text()
            for mod in ('drum_sounds', 'fsd50k_extra'):
                self.assertNotIn(mod, src, p.name)
        self.assertNotIn('drum_sounds', (ROOT / 'labelmap.py').read_text())
        self.assertNotIn('drum_sounds', (ROOT / 'labels_extra.py').read_text())


class FSD50KTests(unittest.TestCase):
    def items(self):
        return [{'id': f'fsd50k:{i}', 'labels': {'cat:drums': 'absent'}} for i in range(4)]

    def test_drum_classes_show_drums_only_when_asked(self):
        classes = {'0': {'Hi-hat', 'Percussion'}, '1': {'Drum'}, '2': {'Cymbal'}, '3': {'Piano'}}
        items = self.items()
        fsd50k_extra.relabel(items, 'eval', strings=True, classes=classes)   # default: the old kit-only labels
        self.assertEqual([it['labels']['cat:drums'] for it in items], ['absent'] * 4)
        items = self.items()
        fsd50k_extra.relabel(items, 'eval', strings=True, classes=classes, drums_any=True)
        self.assertEqual([it['labels']['cat:drums'] for it in items], ['present', 'present', 'present', 'absent'])


class TrainLoadTests(unittest.TestCase):
    def test_load_source_counts_one_shots_as_drums(self):
        train = load_train()
        j = train.CLASSES.index('cat:drums')
        items = [{'id': 'a', 'artist': 'x', 'labels': {'cat:hi-hat': 1.0, 'cat:drums': 0.0}, 'weakAbsent': ['cat:drums']},
                 {'id': 'b', 'artist': 'y', 'labels': {'cat:bell': 1.0, 'cat:drums': 0.0}}]
        with tempfile.TemporaryDirectory() as d:
            mel = os.path.join(d, 'm.npy'); np.save(mel, np.zeros((2, 1), np.float32))
            src = train.load_source('t', mel, [dict(it, labels=dict(it['labels'])) for it in items], 0.1)
            self.assertEqual(src['y'][:, j].tolist(), [1.0, 0.0]); self.assertEqual(src['w'][0, j], 1.0)
            train.DRUMS_ANY = False   # --drums-kit-only: the old labels
            src = train.load_source('t', mel, [dict(it, labels=dict(it['labels'])) for it in items], 0.1)
            self.assertEqual(src['y'][:, j].tolist(), [0.0, 0.0]); self.assertAlmostEqual(float(src['w'][0, j]), 0.1)


if __name__ == '__main__':
    unittest.main()
