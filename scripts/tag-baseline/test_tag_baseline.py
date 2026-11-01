"""Tests for the tag-baseline set builder and summary (stdlib only). Run: python3 scripts/tag-baseline/test_tag_baseline.py"""
import json, os, subprocess, sys, tempfile, unittest, unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_set  # noqa: E402
import summarize  # noqa: E402


def row(fname, labels):
    return {'fname': str(fname), 'labels': ','.join(labels)}


class BuildSet(unittest.TestCase):
    def setUp(self):
        self.rows = [row(i, ['Piano', 'Musical_instrument']) for i in range(1, 11)] + \
                    [row(i, ['Bass_drum', 'Drum']) for i in range(11, 15)] + \
                    [row(i, ['Telephone']) for i in range(15, 25)] + [row(99, ['Piano'])]
        self.info = {str(i): {'uploader': f'u{i % 3}', 'license': 'cc0'} for i in range(1, 25)} | {'99': {'uploader': 'banned'}}
        self.reserved = lambda fname, up: up == 'banned'

    def test_caps_reserved_and_negatives(self):
        cat, clips, items, _ = build_set.build(self.rows, self.info, per_tag=4, per_uploader=1, negatives=3, reserved=self.reserved)
        names = {c['fname'] for c in clips}
        self.assertNotIn('99', names)                                    # reserved uploader skipped
        piano = [c for c in clips if 'piano' in c['tags']]
        self.assertEqual(len(piano), 3)                                  # 3 uploaders, at most 1 each, under the cap of 4
        self.assertEqual(len({c['uploader'] for c in piano}), 3)
        empty = [c for c in clips if not c['tags']]
        self.assertEqual(len(empty), 3)                                  # negatives carry no mapped class
        for it in items:                                                 # every clip labels every tag, present or absent
            self.assertEqual(set(it['labels']), {f'cat:{t}' for t in cat})
            self.assertTrue(it['id'].startswith('fsd50k-eval:'))
        kick = next(i for i in items if i['id'] == 'fsd50k-eval:11')
        self.assertEqual(kick['labels']['cat:kick'], 'present')
        self.assertEqual(kick['labels']['cat:piano'], 'absent')

    def test_drums_means_any_drum_but_selection_keeps_the_training_map(self):
        rows = self.rows + [row(30, ['Snare_drum', 'Drum']), row(31, ['Tabla', 'Drum']), row(32, ['Drum']), row(33, ['Hi-hat', 'Cymbal'])]
        info = self.info | {str(i): {'uploader': f'v{i}'} for i in range(30, 34)}
        _, clips, items, _ = build_set.build(rows, info, per_tag=4, per_uploader=4, negatives=20, reserved=self.reserved)
        lab = {i['id']: i['labels'] for i in items}
        for fname in (11, 30, 31, 32):                                   # kick, snare, tabla and plain drum clips all count as drums
            self.assertEqual(lab[f'fsd50k-eval:{fname}']['cat:drums'], 'present', fname)
        self.assertEqual(lab['fsd50k-eval:33']['cat:drums'], 'absent')   # a cymbal or hi-hat on its own is not a drum
        self.assertEqual(lab['fsd50k-eval:11']['cat:kick'], 'present')
        plain = next(c for c in clips if c['fname'] == '32')
        self.assertEqual(plain['tags'], [])                              # selection still sees no mapped class: it can be a negative
        before = build_set.build(self.rows, self.info, 4, 1, 3, self.reserved)[1]
        with unittest.mock.patch.dict(build_set.EVAL_LABELS, clear=True):     # the drums relabel never moves which clips are chosen
            self.assertEqual([c['fname'] for c in build_set.build(self.rows, self.info, 4, 1, 3, self.reserved)[1]], [c['fname'] for c in before])

    def test_only_tags_tuning_set(self):
        _, clips, items, _ = build_set.build(self.rows, self.info, per_tag=4, per_uploader=4, negatives=5, reserved=self.reserved,
                                             only=['kick'], prefix='fsd50k-dev')
        self.assertTrue(all(i['id'].startswith('fsd50k-dev:') for i in items))
        self.assertEqual(sum('kick' in c['tags'] for c in clips), 4)
        negs = [c for c in clips if 'kick' not in c['tags']]
        self.assertEqual(len(negs), 5)                                   # negatives lack the target but may carry other tags (piano)
        self.assertTrue(any(c['tags'] for c in negs))

    def test_deterministic(self):
        a = build_set.build(self.rows, self.info, 4, 2, 3, self.reserved)[2]
        b = build_set.build(list(reversed(self.rows)), self.info, 4, 2, 3, self.reserved)[2]
        self.assertEqual(a, b)


class Summary(unittest.TestCase):
    def test_micro_macro(self):
        c = lambda tp, fp, fn, neg: {'all': {'tp': tp, 'fp': fp, 'fn': fn, 'positives': tp + fn, 'negatives': neg, 'tpMaybe': 0, 'fpMaybe': 0,
                                             'falseAlarmRate': fp / neg, 'passes6030': False}}
        rep = {'current': {'source:piano': c(8, 2, 2, 90), 'source:organ': c(0, 0, 10, 90)}, 'clips': 100, 'complete': True, 'unscoredClips': 0,
               'models': {}, 'taggerRevision': 'x', 'learnedRevision': 'y', 'shortClipRevision': 'z', 'scope': 's'}
        with tempfile.TemporaryDirectory() as d:
            json.dump(rep, open(os.path.join(d, 'r.json'), 'w')); json.dump({'items': []}, open(os.path.join(d, 'i.json'), 'w'))
            subprocess.run([sys.executable, os.path.join(HERE, 'summarize.py'), os.path.join(d, 'r.json'), os.path.join(d, 'i.json'), os.path.join(d, 'o')],
                           check=True, capture_output=True)
            s = json.load(open(os.path.join(d, 'o', 'summary.json')))
        self.assertEqual(s['micro'], {'precision': 0.8, 'recall': 0.4, 'f1': 0.533, 'tp': 8, 'fp': 2, 'fn': 12})
        self.assertEqual(s['macro']['precision'], 0.4)                   # organ never shown: precision counts 0
        self.assertEqual(s['macro']['f1'], 0.4)
        self.assertEqual(s['counts']['70_70'], 1)

    def test_f1(self):
        self.assertEqual(summarize.f1(None, 0.5), 0.0)
        self.assertAlmostEqual(summarize.f1(0.5, 0.5), 0.5)


if __name__ == '__main__':
    unittest.main()
