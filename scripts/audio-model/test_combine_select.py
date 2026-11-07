"""Offline checks for combine_select.py: the combiner chooses on validation clips and never on held-out test sets."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('combine_select', Path(__file__).with_name('combine_select.py'))
cs = importlib.util.module_from_spec(spec); spec.loader.exec_module(cs)


def th(**sources):
    """thresholds.json row with <source>Val entries: name=(precision, recall[, positives, negatives])."""
    row = {'enabled': True, 'threshold': 0.5}
    for n, v in sources.items():
        p, r, pos, neg = (*v, 50, 500)[:4] if len(v) == 2 else v
        row[f'{n}Val'] = {'precision': p, 'recall': r, 'positives': pos, 'negatives': neg}
    return row


def run(name, rows, ev=None):
    return {'name': name, 'th': rows, 'eval': ev or {}}


# A test set where the candidate looks far better: the combiner must ignore it.
GREAT_ON_TEST = {'eval-fsd50k': {'all': {'cat:x': {'precision': 1.0, 'recall': 1.0, 'positives': 99}}}}


class ChooseTests(unittest.TestCase):
    def test_test_sets_never_decide(self):
        runs = [run('ship', {'cat:x': th(fsd50k=(.8, .8))}), run('new', {'cat:x': th(fsd50k=(.8, .7))}, GREAT_ON_TEST)]
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'ship')

    def test_validation_gain_wins(self):
        runs = [run('ship', {'cat:x': th(fsd50k=(.6, .6))}), run('new', {'cat:x': th(fsd50k=(.7, .65))})]
        p = cs.choose(['cat:x'], runs)['cat:x']
        self.assertEqual(p['run'], 'new'); self.assertIn('validation', p['why'])

    def test_margin(self):
        runs = [run('ship', {'cat:x': th(fsd50k=(.6, .6))}), run('new', {'cat:x': th(fsd50k=(.605, .605))})]
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'ship')

    def test_no_drop_below_floor_where_shipped_passed(self):
        runs = [run('ship', {'cat:x': th(fsd50k=(.75, .75), nsynth=(.3, .3))}),
                run('new', {'cat:x': th(fsd50k=(.69, .9), nsynth=(.9, .9))})]
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'ship')

    def test_thin_sources_ignored(self):
        runs = [run('ship', {'cat:x': th(fsd50k=(.6, .6), tiny=(.1, .1, 3, 500))}),
                run('new', {'cat:x': th(fsd50k=(.6, .6), tiny=(1.0, 1.0, 3, 500))})]
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'ship')

    def test_compared_on_common_sources_and_largest_gain(self):
        runs = [run('ship', {'cat:x': th(fsd50k=(.6, .6), nsynth=(.6, .6))}),
                run('a', {'cat:x': th(fsd50k=(.65, .65))}),                    # +0.05 on fsd50k only
                run('b', {'cat:x': th(fsd50k=(.7, .7), nsynth=(.6, .6))})]   # +0.05 mean over both
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'a')   # tie on gain: the earlier run
        runs[2]['th']['cat:x'] = th(fsd50k=(.8, .8), nsynth=(.62, .62))
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'b')

    def test_keep_only_pin(self):
        runs = [run('ship', {'cat:x': th(f=(.5, .5)), 'cat:y': th(f=(.5, .5))}),
                run('new', {'cat:x': th(f=(.9, .9)), 'cat:y': th(f=(.9, .9))})]
        self.assertEqual(cs.choose(['cat:x'], runs, keep={'cat:x'})['cat:x']['run'], 'ship')
        p = cs.choose(['cat:x', 'cat:y'], runs, only={'new': {'cat:y'}})
        self.assertEqual((p['cat:x']['run'], p['cat:y']['run']), ('ship', 'new'))
        self.assertEqual(cs.choose(['cat:x'], [runs[1], runs[0]], pin={'cat:x': 'ship'})['cat:x']['why'], 'pinned by hand')

    def test_disabled_or_missing_rows(self):
        runs = [run('ship', {'cat:x': {'enabled': False, 'reason': '3 validation positives'}}), run('new', {'cat:x': th(f=(.9, .9))})]
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'ship')

    def test_no_prediction_source_counts_as_zero(self):
        new = th(nsynth=(.9, .9)); new['fsd50kVal'] = {'precision': None, 'recall': 0.0, 'positives': 50, 'negatives': 500}
        runs = [run('ship', {'cat:x': th(fsd50k=(.8, .8), nsynth=(.4, .4))}), run('new', {'cat:x': new})]
        self.assertEqual(cs.choose(['cat:x'], runs)['cat:x']['run'], 'ship')

    def test_new_output_respects_only(self):
        runs = [run('ship', {'cat:y': th(f=(.5, .5))}), run('a', {'cat:x': th(f=(.6, .6))}), run('b', {'cat:x': th(f=(.5, .5))})]
        self.assertEqual(cs.choose(['cat:x'], runs, only={'a': {'cat:y'}})['cat:x']['run'], 'b')
        with self.assertRaises(AssertionError):
            cs.choose(['cat:x'], runs, only={'a': {'cat:y'}, 'b': {'cat:y'}})


if __name__ == '__main__':
    unittest.main()
