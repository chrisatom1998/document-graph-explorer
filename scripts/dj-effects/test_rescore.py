"""Offline synthetic rescore regressions; requires NumPy, no audio or training."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from eligibility import eligible_metrics
from rescore import rescore


def metrics(tp, fp, fn):
    return {'tp': tp, 'fp': fp, 'fn': fn,
            'precision': tp / (tp + fp) if tp + fp else 0.0,
            'recall': tp / (tp + fn) if tp + fn else 0.0}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Fixture:
    """Ten tiny fingerprints cover both routes, overlap, renders, and later rounds."""
    def __init__(self, root, sharded=True):
        self.root = root
        self.artifacts = root / 'artifacts'
        self.evaluation = root / 'evaluation'
        self.shard = self.artifacts / 'shard-0' if sharded else self.artifacts
        self.manifest = self.shard / 'manifest-0.json'
        self.renders = self.shard / 'renders-0.json'
        self.durations = self.shard / 'durations-0.json'
        self.embeddings = self.shard / 'emb-0.jsonl'
        self.heads = self.evaluation / 'heads.json'
        self.recorded = root / 'original-report.json'
        self.baseline = root / 'baseline-learned.json'
        self.short = root / 'short-clip.json'
        self.labels = root / 'labels.json'
        self.clips = self.evaluation / 'clips.json'

        def clip(identifier, labels, split='heldout', round_number=1, kind='real'):
            return {'id': identifier, 'labels': labels, 'split': split, 'round': round_number,
                    'kind': kind, 'group': identifier, 'username': identifier}

        positive = ['kalimba']
        real = [clip('train-positive', positive, 'train'), clip('train-negative', [], 'train'),
                clip('long-positive', positive), clip('long-negative', []),
                clip('short-positive', positive), clip('short-negative', []),
                clip('second-positive', positive), clip('overlap', ['marimba']),
                clip('later-positive', positive, round_number=2)]
        render = clip('render', positive, 'train', kind='render')
        self.put(self.manifest, {'clips': real})
        self.put(self.renders, {'clips': [render]})
        self.put(self.clips, {'clips': copy.deepcopy(real)})
        self.put(self.durations, {c['id']: (2.25 if c['id'].startswith('short-') else 4)
                                  for c in real})
        # [3, 4] normalises to [0.6, 0.8]: the rounded bias puts this
        # positive exactly at threshold. An unrounded -0.6000004 misses it.
        rows = []
        for c in [*real, render]:
            vector = [3, 4] if c['id'] == 'long-positive' else (
                [1, 3] if c['id'] == 'long-negative' else (
                    [0, 1] if c['id'] in ('train-negative', 'later-positive') else [1, 0]))
            rows.append({'id': c['id'], 'embedding': vector + [0] * 510})
        self.embeddings.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        # Identical duplicate rows are accepted once, as in the original trainer.
        self.embeddings.write_text(self.embeddings.read_text() + json.dumps(rows[0]) + '\n')
        head = {'label': 'kalimba', 'group': 'source', 'weights': [1] + [0] * 511,
                'bias': -0.6, 'threshold': 0.5}
        self.put(self.heads, {'heads': [head]})
        self.put(self.baseline, {'heads': [{**head, 'bias': -0.5, 'maybe': True}]})
        self.put(self.short, {'heads': [{**head, 'bias': -0.3}], 'blocks': ['clapRepeat'],
                             'maxSeconds': 2.25, 'mean': [0.5] + [0] * 511,
                             'std': [2] + [1] * 511})
        self.put(self.labels, {'labels': [{'label': 'kalimba', 'group': 'source'}],
                              'overlap': [['kalimba', 'marimba']]})
        self.put(self.recorded, {
            'clips': 10, 'trainClips': 3, 'heldOutClips': 7, 'primaryHeldOutClips': 6,
            'heldOutUploaders': 7, 'labels': {'kalimba': {
                'group': 'source', 'trainPositive': 1, 'trainNegative': 1, 'trainRenders': 1,
                'trainUploaders': 1, 'testPositive': 3, 'testNegative': 2, 'testUploaders': 3,
                'threshold': 0.5, **metrics(2, 1, 1),
                'heldOutOneShot': {'positives': 1, 'negatives': 1, **metrics(1, 1, 0)},
                'current': [
                    {'file': 'learned.json', 'threshold': 0.5, 'maybe': True, **metrics(3, 1, 0)},
                    {'file': 'short-clip.json', 'threshold': 0.5, 'maybe': False, **metrics(0, 0, 1)}],
                'extended': {'new': {'positives': 4, 'negatives': 2, **metrics(2, 1, 2)},
                             'current': {'positives': 4, 'negatives': 2, **metrics(3, 1, 1)}}}}})
        self.args = SimpleNamespace(
            artifacts=self.artifacts, evaluation=self.evaluation, recorded_report=self.recorded,
            baseline_learned=self.baseline, short_clip=self.short, labels=self.labels, primary_round=1,
            recorded_report_sha256=sha256(self.recorded), baseline_sha256=sha256(self.baseline),
            heads_sha256=sha256(self.heads))
        # Existing outputs must survive any validation failure byte-for-byte.
        (self.evaluation / 'report.json').write_text('{"previous": true}\n')
        (self.evaluation / 'report.txt').write_text('previous report\n')

    @staticmethod
    def put(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    @staticmethod
    def read(path):
        return json.loads(path.read_text())

    def snapshot(self):
        return {str(p.relative_to(self.root)): (p.read_bytes(), p.stat().st_mtime_ns)
                for p in self.root.rglob('*') if p.is_file()}

    def run(self):
        with contextlib.redirect_stdout(io.StringIO()):
            rescore(self.args)
        return self.read(self.evaluation / 'report.json')


class RescoreTests(unittest.TestCase):
    def fixture(self, **kwargs):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return Fixture(Path(directory.name), **kwargs)

    def assert_rejected_without_writes(self, fixture, message):
        before = fixture.snapshot()
        with self.assertRaisesRegex(ValueError, message):
            fixture.run()
        self.assertEqual(fixture.snapshot(), before)

    def test_rescores_rounded_heads_on_original_populations_and_records_provenance(self):
        for sharded in (True, False):
            with self.subTest(sharded=sharded):
                f = self.fixture(sharded=sharded)
                before = f.snapshot()
                result = f.run()
                row = result['labels']['kalimba']
                self.assertEqual({k: row[k] for k in metrics(3, 1, 0)}, metrics(3, 1, 0))
                self.assertEqual(row['threshold'], 0.5)
                self.assertTrue(row['passes70'])
                route = {'positives': 2, 'negatives': 1, 'unknownDurations': 0,
                         **metrics(2, 0, 0), 'maxSeconds': 2.25, 'subset': 'held-out clips > 2.25 s'}
                self.assertEqual(row['heldOutLongClip'], route)
                self.assertEqual(row['current'][0]['heldOutLongClip'], route)
                self.assertEqual(row['heldOutOneShot'], {'positives': 1, 'negatives': 1, **metrics(1, 1, 0)})
                self.assertEqual({k: row['current'][1][k] for k in metrics(0, 0, 1)}, metrics(0, 0, 1))
                extended = {**route, 'positives': 3, **metrics(2, 0, 1)}
                self.assertEqual(row['extended']['new']['heldOutLongClip'], extended)
                self.assertEqual(row['extended']['current']['heldOutLongClip'], extended)
                provenance = result['rescoring']
                self.assertEqual((provenance['heldOutShortClips'], provenance['heldOutLongClips'],
                                  provenance['heldOutUnknownDurations']), (2, 5, 0))
                self.assertEqual(provenance['recordedUnroundedComparisons'], 3)
                self.assertEqual(provenance['verifiedCurrentComparisons'], 2)
                self.assertEqual(provenance['primaryRound'], 1)
                self.assertEqual(provenance['roundingDifferences'], [
                    {'label': 'kalimba', 'subset': 'all primary held-out clips',
                     'recordedUnrounded': metrics(2, 1, 1), 'exportedRounded': metrics(3, 1, 0)},
                    {'label': 'kalimba', 'subset': 'all extended held-out clips',
                     'recordedUnrounded': metrics(2, 1, 2), 'exportedRounded': metrics(3, 1, 1)}])
                for key, path in {'recordedReportSha256': f.recorded, 'headsSha256': f.heads,
                                  'baselineLearnedSha256': f.baseline, 'shortClipSha256': f.short,
                                  'labelsSha256': f.labels, 'clipsSha256': f.clips}.items():
                    self.assertEqual(provenance[key], sha256(path))
                self.assertEqual(provenance['sourceFileSha256'], {
                    str(p.relative_to(f.artifacts)): sha256(p)
                    for p in (f.manifest, f.renders, f.durations, f.embeddings)})
                text = (f.evaluation / 'report.txt').read_text()
                self.assertIn('Rounded versus recorded unrounded differences: 2.', text)
                self.assertIn('Rounding difference: kalimba / all primary held-out clips', text)
                after = f.snapshot()
                self.assertEqual(set(after), set(before))
                for path in before.keys() - {'evaluation/report.json', 'evaluation/report.txt'}:
                    self.assertEqual(after[path], before[path], path)
                f.run()
                self.assertEqual((f.evaluation / 'report.json').read_bytes(), after['evaluation/report.json'][0])
                self.assertEqual((f.evaluation / 'report.txt').read_bytes(), after['evaluation/report.txt'][0])

    def test_changed_pinned_report_or_coefficients_are_rejected(self):
        for name, message in [('recorded', 'recorded report SHA256 mismatch'),
                              ('baseline', 'baseline learned.json SHA256 mismatch'),
                              ('heads', 'exported heads.json SHA256 mismatch')]:
            with self.subTest(input=name):
                f = self.fixture()
                path = getattr(f, name)
                value = f.read(path)
                if name == 'recorded':
                    value['clips'] += 1
                else:
                    value['heads'][0]['weights'][0] += 1
                f.put(path, value)
                self.assert_rejected_without_writes(f, message)

    def test_baseline_coefficients_must_reproduce_recorded_scores_even_with_new_pin(self):
        f = self.fixture()
        model = f.read(f.baseline)
        model['heads'][0]['bias'] = -2
        f.put(f.baseline, model)
        f.args.baseline_sha256 = sha256(f.baseline)
        self.assert_rejected_without_writes(f, 'kalimba/current/learned.json: tp differs')

    def test_exported_head_threshold_must_match_report_even_with_new_pin(self):
        f = self.fixture()
        model = f.read(f.heads)
        model['heads'][0]['threshold'] = 0.6
        f.put(f.heads, model)
        f.args.heads_sha256 = sha256(f.heads)
        self.assert_rejected_without_writes(f, 'exported head threshold/group differs')

    def test_rejects_inconsistent_report_populations_and_metrics(self):
        for field, message in [('clips', 'clips differs'), ('testPositive', 'testPositive differs'),
                               ('precision', 'aggregate: precision differs'),
                               ('rescoring', 'must be the original training report')]:
            with self.subTest(field=field):
                f = self.fixture()
                report = f.read(f.recorded)
                if field in ('clips', 'rescoring'):
                    report[field] = 99
                else:
                    report['labels']['kalimba'][field] = 99
                f.put(f.recorded, report)
                f.args.recorded_report_sha256 = sha256(f.recorded)
                self.assert_rejected_without_writes(f, message)

    def test_rejects_ambiguous_or_incomplete_shards(self):
        for duplicate in (True, False):
            with self.subTest(duplicate=duplicate):
                f = self.fixture()
                if duplicate:
                    f.put(f.artifacts / f.manifest.name, f.read(f.manifest))
                    message = 'ambiguous merged/sharded manifest'
                else:
                    f.durations.rename(f.shard / 'durations-1.json')
                    message = 'manifest/render/duration shard sets differ'
                self.assert_rejected_without_writes(f, message)

    def test_rejects_duplicate_metadata_heldout_renders_and_split_leakage(self):
        for case, message in [('duplicate', 'duplicate metadata'), ('render', 'held-out render'),
                              ('split', 'uploader crosses train/heldout split')]:
            with self.subTest(case=case):
                f = self.fixture()
                path = f.renders if case == 'render' else f.manifest
                data = f.read(path)
                if case == 'duplicate':
                    data['clips'].append(data['clips'][0])
                elif case == 'render':
                    data['clips'][0]['split'] = 'heldout'
                else:
                    data['clips'][2]['group'] = data['clips'][0]['group']
                f.put(path, data)
                self.assert_rejected_without_writes(f, message)

    def test_rejects_changed_clip_metadata_and_label_specification(self):
        for name, message in [('clips', 'clips.json metadata differs'),
                              ('labels', 'label specification/order differs')]:
            with self.subTest(input=name):
                f = self.fixture()
                path = getattr(f, name)
                data = f.read(path)
                if name == 'clips':
                    data['clips'][0]['username'] = 'different-uploader'
                else:
                    data['labels'][0]['label'] = 'different-label'
                f.put(path, data)
                self.assert_rejected_without_writes(f, message)

    def test_rejects_conflicting_invalid_and_unmatched_fingerprints(self):
        for case, message in [('conflict', 'conflicting fingerprints'), ('zero', 'invalid fingerprint'),
                              ('metadata', 'embedding without metadata')]:
            with self.subTest(case=case):
                f = self.fixture()
                rows = [json.loads(line) for line in f.embeddings.read_text().splitlines()]
                if case == 'conflict':
                    rows[-1]['embedding'][0] = 2
                elif case == 'zero':
                    rows[0]['embedding'] = [0] * 512
                else:
                    rows[0]['id'] = 'unknown-clip'
                f.embeddings.write_text(''.join(json.dumps(row) + '\n' for row in rows))
                self.assert_rejected_without_writes(f, message)

    def test_missing_or_invalid_durations_stay_unknown_and_prevent_eligibility(self):
        for value in ('missing', None, 0, -1, True, '4', float('nan'), float('inf')):
            with self.subTest(duration=value):
                f = self.fixture()
                data = f.read(f.durations)
                if value == 'missing':
                    del data['second-positive']
                else:
                    data['second-positive'] = value
                f.put(f.durations, data)
                report = f.run()
                row = report['labels']['kalimba']
                self.assertEqual(row['heldOutLongClip']['unknownDurations'], 1)
                self.assertEqual(row['heldOutLongClip']['positives'], 1)
                self.assertEqual(row['heldOutLongClip']['tp'], 1)
                self.assertEqual(row['heldOutOneShot']['positives'], 1)
                self.assertEqual(report['rescoring']['heldOutUnknownDurations'], 1)
                self.assertEqual(report['rescoring']['heldOutLongClips'], 4)
                self.assertEqual(eligible_metrics(row, 2.25, min_positives=1),
                                 (None, 'held-out clip durations are missing or invalid'))

    def test_source_hash_records_changed_duration_bytes_without_claiming_a_pin(self):
        f = self.fixture()
        first = f.run()
        durations = f.read(f.durations)
        durations['second-positive'] = 5  # Still long: scores must not change.
        f.put(f.durations, durations)
        second = f.run()
        first_hashes = first['rescoring'].pop('sourceFileSha256')
        second_hashes = second['rescoring'].pop('sourceFileSha256')
        key = str(f.durations.relative_to(f.artifacts))
        self.assertNotEqual(first_hashes[key], second_hashes[key])
        self.assertEqual(second_hashes.pop(key), sha256(f.durations))
        first_hashes.pop(key)
        self.assertEqual(first_hashes, second_hashes)
        self.assertEqual(first, second)

    def test_late_validation_failure_neither_creates_nor_rewrites_reports(self):
        for existing in (True, False):
            with self.subTest(existing=existing):
                f = self.fixture()
                if not existing:
                    (f.evaluation / 'report.json').unlink()
                    (f.evaluation / 'report.txt').unlink()
                recorded = f.read(f.recorded)
                recorded['labels']['kalimba']['extended']['new']['positives'] += 1
                f.put(f.recorded, recorded)
                f.args.recorded_report_sha256 = sha256(f.recorded)
                self.assert_rejected_without_writes(f, 'extended population differs')


if __name__ == '__main__':
    unittest.main()
