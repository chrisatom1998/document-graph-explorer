"""Offline regression tests: no audio, model loading, network, or training."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from eligibility import eligible_metrics, long_clip_metrics

HERE = Path(__file__).resolve().parent


def metric(tp, fp, fn, negatives=100, unknown=0):
    return {'subset': 'held-out clips > 2.25 s', 'maxSeconds': 2.25,
            'positives': tp + fn, 'negatives': negatives, 'unknownDurations': unknown,
            'tp': tp, 'fp': fp, 'fn': fn,
            'precision': tp / (tp + fp) if tp + fp else 0,
            'recall': tp / (tp + fn) if tp + fn else 0}


def entry(long_metrics, precision=.99, recall=.99):
    return {'precision': precision, 'recall': recall, 'testPositive': 50,
            'testNegative': 100, 'trainPositive': 100, 'threshold': .8,
            'heldOutLongClip': long_metrics}


def head(label, maybe=False, old=False):
    return {'label': label, 'group': 'production' if label in ('tambourine', 'conga') else 'source',
            'weights': [float(old)] * 512, 'bias': 0, 'threshold': .8,
            **({'maybe': True} if maybe else {})}


def ship(label, row, current=None, all_ineligible=False):
    """Exercise the actual CLI against isolated files; a control head always ships."""
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        def put(path, obj):
            file = root / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(json.dumps(obj))
        put('public/sound-model/learned.json', {'version': 1, 'encoder': 'test', 'revision': 'base',
                                             'examples': [], 'heads': current or []})
        put('public/sound-model/short-clip.json', {'maxSeconds': 2.25, 'heads': []})
        put('public/sound-model/manifest.json', {'sha256': {}})
        put('src/audio/djCatalog.json', {'version': 1, 'categories': [
            {'group': h['group'], 'label': h['label'], 'aliases': []} for h in (head(label), head('kalimba'))]})
        control = entry(metric(18, 2, 2))
        if all_ineligible: del control['heldOutLongClip']
        put('report/report.json', {'labels': {label: row, 'kalimba': control}})
        put('report/heads.json', {'heads': [head(label), head('kalimba')]})
        before = (root / 'public/sound-model/learned.json').read_bytes()
        result = subprocess.run([sys.executable, str(HERE / 'ship.py'), 'report'], cwd=root,
                       env={**os.environ, 'LABELS': 'labels-tags.json', 'REVISION_TAG': 'test'},
                       capture_output=True, text=True, check=not all_ineligible)
        if all_ineligible:
            assert before == (root / 'public/sound-model/learned.json').read_bytes()
            assert not (root / 'report/shipped.json').exists()
            return result
        decisions = json.loads((root / 'report/shipped.json').read_text())
        model_bytes = (root / 'public/sound-model/learned.json').read_bytes()
        model = json.loads(model_bytes)
        manifest = json.loads((root / 'public/sound-model/manifest.json').read_text())
        assert hashlib.sha256(model_bytes).hexdigest() == manifest['sha256']['learned.json']
        assert decisions['learnedSha256'] == manifest['sha256']['learned.json']
        assert json.loads((root / 'src/audio/calibratedLabels.json').read_text()) == sorted(h['label'] for h in model['heads'])
        return next(r for r in decisions['heads'] if r['label'] == label), model


class DurationScoringTests(unittest.TestCase):
    def test_exact_one_shot_boundary_is_excluded(self):
        result = long_clip_metrics([True, True, False], [True, False, True], [2.25, 2.250001, 10], 2.25)
        self.assertEqual((result['tp'], result['fp'], result['fn']), (0, 1, 1))
        self.assertEqual((result['positives'], result['negatives']), (1, 1))

    def test_unknown_or_invalid_duration_is_never_a_long_clip(self):
        durations = [None, float('nan'), float('inf'), -1, 0, True, '10']
        result = long_clip_metrics([True] * 7, [True] * 7, durations, 2.25)
        self.assertEqual(result['unknownDurations'], 7)
        self.assertEqual(result['positives'], 0)
        self.assertIsNone(eligible_metrics({'heldOutLongClip': result}, 2.25)[0])

    def test_mismatched_scoring_inputs_fail(self):
        with self.assertRaises(ValueError):
            long_clip_metrics([True], [], [10], 2.25)

    def test_gate_recomputes_metrics_from_counts(self):
        row = entry({**metric(1, 5, 11), 'precision': 1, 'recall': 1})
        actual, reason = eligible_metrics(row, 2.25)
        self.assertIsNone(reason)
        self.assertAlmostEqual(actual['precision'], 1 / 6)
        self.assertAlmostEqual(actual['recall'], 1 / 12)

    def test_missing_mismatched_or_inconsistent_evidence_fails_closed(self):
        good = metric(18, 2, 2)
        for row in ({}, entry({**good, 'maxSeconds': 3}), entry({**good, 'positives': 19}),
                    entry({**good, 'unknownDurations': 1}), entry({**good, 'tp': -1}),
                    entry({**good, 'negatives': 1}), entry(metric(8, 1, 1))):
            with self.subTest(row=row):
                self.assertIsNone(eligible_metrics(row, 2.25)[0])


class ShippingTests(unittest.TestCase):
    def test_committed_release_uses_verified_runtime_subset(self):
        root = HERE.parent.parent
        evaluation = root / 'docs/evaluations/tag-heads-2026-10-09'
        report = json.loads((evaluation / 'report.json').read_text())
        shipped = json.loads((evaluation / 'shipped.json').read_text())
        learned = json.loads((root / 'public/sound-model/learned.json').read_text())
        self.assertEqual(report['rescoring']['roundingDifferences'], [])
        self.assertEqual(report['rescoring']['heldOutUnknownDurations'], 0)
        selected = [row for row in shipped['heads'] if row['shipped']]
        self.assertEqual({row['label'] for row in selected},
                         {'kalimba', 'falling', 'viola', 'marimba', 'djembe', 'whistle', 'bongo', 'tom'})
        for row in selected:
            evidence, why = eligible_metrics(report['labels'][row['label']], 2.25)
            self.assertIsNone(why)
            self.assertEqual((row['precision'], row['recall']), (evidence['precision'], evidence['recall']))
            self.assertEqual(row['tier'], 'full' if min(evidence['precision'], evidence['recall']) >= .7 else 'maybe')
            self.assertGreaterEqual(evidence['precision'], .45)
            self.assertGreaterEqual(evidence['recall'], .30)
            actual = next(h for h in learned['heads'] if h['label'] == row['label'])
            self.assertFalse(actual.get('oneShot', False))

    def test_rejects_heads_only_passed_by_disabled_short_clips(self):
        for label, values in [('tambourine', (1, 5, 11)), ('conga', (13, 19, 9)), ('gliding', (42, 52, 58))]:
            with self.subTest(label=label):
                decision, model = ship(label, entry(metric(*values)))
                self.assertFalse(decision['shipped'])
                self.assertNotIn(label, [h['label'] for h in model['heads']])

    def test_djembe_aggregate_pass_cannot_promote_long_route_to_full(self):
        decision, model = ship('djembe', entry(metric(16, 10, 7), precision=35 / 47, recall=35 / 44))
        self.assertTrue(decision['shipped'])
        self.assertEqual(decision['tier'], 'maybe')
        self.assertFalse(decision['meets70'])
        h = next(h for h in model['heads'] if h['label'] == 'djembe')
        self.assertTrue(h['maybe'])
        self.assertNotIn('oneShot', h)

    def test_missing_duration_evidence_cannot_ship(self):
        row = entry(metric(18, 2, 2)); del row['heldOutLongClip']
        self.assertFalse(ship('djembe', row)[0]['shipped'])

    def test_legacy_report_abstention_explains_how_to_rescore(self):
        row = entry(metric(18, 2, 2)); del row['heldOutLongClip']
        result = ship('djembe', row, all_ineligible=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('runtime-eligible long clips were not scored', result.stdout)
        self.assertIn('DURATIONS or rescore.py', result.stderr)

    def test_rejected_small_sample_reports_the_eligible_population(self):
        decision, _ = ship('djembe', entry(metric(8, 1, 1)))
        self.assertFalse(decision['shipped'])
        self.assertEqual(decision['testPositive'], 9)
        self.assertEqual(decision['evaluationSubset'], 'held-out clips > 2.25 s')

    def test_candidate_and_current_are_compared_on_eligible_subset(self):
        row = entry(metric(11, 9, 9))
        row['current'] = [{'file': 'learned.json', 'maybe': True, 'precision': .1, 'recall': .1,
                           'heldOutLongClip': metric(16, 4, 4)}]
        old = head('djembe', maybe=True, old=True)
        decision, model = ship('djembe', row, [old])
        self.assertFalse(decision['shipped'])
        self.assertEqual(next(h for h in model['heads'] if h['label'] == 'djembe'), old)

    def test_missing_or_different_current_subset_prevents_replacement(self):
        for cur in ({}, {'heldOutLongClip': metric(10, 10, 9)}):
            row = entry(metric(18, 2, 2))
            row['current'] = [{'file': 'learned.json', 'maybe': True, **cur}]
            self.assertFalse(ship('djembe', row, [head('djembe', maybe=True)])[0]['shipped'])

    def test_normal_head_cannot_be_replaced_with_only_maybe_quality(self):
        row = entry(metric(16, 10, 7))
        row['current'] = [{'file': 'learned.json', 'maybe': False, 'heldOutLongClip': metric(10, 20, 13)}]
        self.assertFalse(ship('djembe', row, [head('djembe')])[0]['shipped'])

    def test_extended_comparison_also_uses_eligible_subset(self):
        row = entry(metric(18, 2, 2))
        row['current'] = [{'file': 'learned.json', 'maybe': True, 'heldOutLongClip': metric(10, 10, 10)}]
        row['extended'] = {'new': entry(metric(10, 10, 10)), 'current': entry(metric(18, 2, 2))}
        self.assertFalse(ship('djembe', row, [head('djembe', maybe=True)])[0]['shipped'])
        row = copy.deepcopy(row); del row['extended']['current']['heldOutLongClip']
        self.assertFalse(ship('djembe', row, [head('djembe', maybe=True)])[0]['shipped'])


if __name__ == '__main__':
    unittest.main()
