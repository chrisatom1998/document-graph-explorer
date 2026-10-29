"""CPU tests for the sound-tag training scaffold. No network and no Hugging Face job."""
import json
import os
import subprocess
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bars  # noqa: E402
import fit_head  # noqa: E402
import plan  # noqa: E402


class BarTests(unittest.TestCase):
    def test_full_bar_matches_the_app(self):
        self.assertEqual(bars.FULL_PRECISION, 0.50)
        self.assertEqual(bars.FULL_RECALL, 0.50)
        self.assertTrue(bars.meets_full(0.50, 0.50))
        self.assertFalse(bars.meets_full(0.60, 0.49))

    def test_maybe_floor_is_the_lower_number(self):
        self.assertTrue(bars.meets_maybe(0.90, 0.45))
        self.assertFalse(bars.meets_maybe(0.90, 0.44))

    def test_tagger_ship_line_is_60_30(self):
        self.assertTrue(bars.meets_tagger_ship(0.60, 0.30))
        self.assertFalse(bars.meets_tagger_ship(0.59, 0.90))
        self.assertFalse(bars.meets_60(0.80, 0.50))

    def test_character_adjectives_stay_maybe(self):
        self.assertEqual(bars.head_tier(0.99, 0.99, 'bright'), 'character-maybe')
        self.assertEqual(bars.head_tier(None, None, 'warm'), 'dsp')

    def test_binding_ignores_a_positives_only_slice_when_a_real_set_exists(self):
        chosen = bars.binding([
            {'name': 'positives-only', 'precision': 1.0, 'recall': 0.1, 'positives': 20, 'negatives': 0},
            {'name': 'fsd', 'precision': 0.8, 'recall': 0.8, 'positives': 60, 'negatives': 100},
        ])
        self.assertEqual(chosen['name'], 'fsd')


class PlanTests(unittest.TestCase):
    def test_estimate_stays_under_the_cap(self):
        cost = plan.estimate(plan.load_config())
        self.assertEqual(cost['usd'], 3.26)
        self.assertTrue(cost['withinCap'])
        self.assertLessEqual(cost['usd'], cost['cap'])

    def test_unknown_flavor_is_refused(self):
        config = plan.load_config()
        config['train'] = {'flavor': 'h200', 'hours': 1, 'jobs': 1}
        with self.assertRaises(SystemExit):
            plan.estimate(config)

    def test_overlap_blocks_a_held_out_id(self):
        self.assertEqual(plan.overlap({'a', 'b'}, {'b', 'c'}), {'b'})
        with self.assertRaises(SystemExit):
            fit_head.refuse_overlap(['clip-1'], ['clip-1'])

    def test_launch_refuses_without_the_confirm_latch(self):
        env = os.environ.copy()
        env.pop('DGE_HF_LAUNCH_CONFIRM', None)
        env.pop('HF_TOKEN', None)
        with self.assertRaises(SystemExit):
            plan.launch(plan.load_config())

    def test_dry_run_prints_the_command_and_does_not_launch(self):
        proc = subprocess.run([sys.executable, os.path.join(HERE, 'plan.py')], check=True, capture_output=True, text=True)
        report = json.loads(proc.stdout.split('dry run only', 1)[0])
        self.assertFalse(report['willLaunch'])
        self.assertIn('hf-launch.py', ' '.join(report['command']))
        self.assertIn('cello', report['recallTags'])
        self.assertNotIn('HF_TOKEN=', ' '.join(report['command']))


class SnapshotTests(unittest.TestCase):
    def test_committed_gap_snapshot_uses_the_repo_bars(self):
        path = os.path.join(HERE, '..', '..', 'docs', 'hf-sound-tag-training', 'gap.json')
        with open(path) as handle:
            report = json.load(handle)
        self.assertEqual(report['summary']['pickable'], 160)
        self.assertEqual(report['summary']['bars']['headFull'], [0.5, 0.5])
        self.assertEqual(report['summary']['bars']['taggerShip'], [0.6, 0.3])
        kick = next(tag for tag in report['tags'] if tag['label'] == 'kick')
        self.assertEqual(kick['tier'], 'full')
        self.assertEqual(kick['decider'], 'tagger')
        self.assertTrue(kick['meets6060'])


class FitTests(unittest.TestCase):
    def test_separable_head_clears_the_full_bar(self):
        rng = np.random.default_rng(0)
        pos = rng.normal(loc=2.0, scale=0.4, size=(30, 2))
        neg = rng.normal(loc=-2.0, scale=0.4, size=(30, 2))
        train_x = np.vstack([pos[:20], neg[:20]])
        train_y = np.array([1] * 20 + [0] * 20)
        test_x = np.vstack([pos[20:], neg[20:]])
        test_y = np.array([1] * 10 + [0] * 10)
        weight, bias = fit_head.fit(train_x, train_y)
        scored = fit_head.counts(fit_head.probabilities(test_x, weight, bias), test_y, 0.5)
        self.assertEqual(scored['tier'], 'full')
        self.assertGreaterEqual(scored['precision'], 0.5)
        self.assertGreaterEqual(scored['recall'], 0.5)


if __name__ == '__main__':
    unittest.main()
