"""Synthetic-only regression tests for motion selection and resumable fetching."""
import json
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from collections import defaultdict
from unittest.mock import patch

MOTION = Path(__file__).parent / 'coverage' / 'motion'


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


def fake_arrow(data=None):
    package = types.ModuleType('pyarrow')
    parquet = types.ModuleType('pyarrow.parquet')
    parquet.read_table = lambda *args, **kwargs: types.SimpleNamespace(to_pydict=lambda: data)
    package.parquet = parquet
    return {'pyarrow': package, 'pyarrow.parquet': parquet}


class FetchTests(unittest.TestCase):
    def test_retry_is_idempotent_and_failed_negative_does_not_consume_uploader(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            jobs = root / 'jobs.json'
            eligible = root / 'eligible.json'
            write_json(jobs, [{'id': 1, 'file': 'fixture', 'row': 0}, {'id': 2, 'file': 'fixture', 'row': 4}])
            write_json(eligible, {'ids': [10, 11, 12, 20], 'user': {'10': 'a', '11': 'b', '12': 'b', '20': 'c'}})
            modules = fake_arrow()
            hub = types.ModuleType('huggingface_hub')
            hub.HfFileSystem = lambda: types.SimpleNamespace(open=lambda *a, **kw: None)
            modules['huggingface_hub'] = hub
            argv = ['fetch_mirror.py', str(jobs), str(root), '--neg-eligible', str(eligible), '--extra', '2']
            with patch.dict(sys.modules, modules), patch.object(sys, 'argv', argv):
                module = runpy.run_path(str(MOTION / 'fetch_mirror.py'))
            state = module['one'].__globals__
            ids_by_group = [[1, 10, 11, 12], [2, 20]]

            class Table:
                def __init__(self, ids): self.ids = ids
                def column(self, name): return types.SimpleNamespace(to_pylist=lambda: self.ids)
                def slice(self, offset, size):
                    return types.SimpleNamespace(to_pylist=lambda: [{'audio': {'bytes': str(self.ids[offset]).encode()}}])

            metadata = types.SimpleNamespace(num_row_groups=2, row_group=lambda g: types.SimpleNamespace(num_rows=len(ids_by_group[g])))
            parquet = types.SimpleNamespace(metadata=metadata, read_row_group=lambda g, **kw: Table(ids_by_group[g]))
            state['pq'].ParquetFile = lambda *a: parquet
            decoded = defaultdict(int)

            def decode(blob):
                decoded[blob] += 1
                if blob == b'11': return None
                if blob == b'20' and decoded[blob] == 1: raise OSError('synthetic transient failure')
                return b'fake-flac'

            state['decode'] = decode
            with patch.object(state['time'], 'sleep'):
                state['one'](('fixture', state['jobs']))
            records = [json.loads(line) for line in (root / 'fetched.jsonl').read_text().splitlines()]
            self.assertEqual(sorted(r['id'] for r in records), [1, 2, 10, 12, 20])
            self.assertEqual(decoded[b'1'], 1)
            self.assertEqual(decoded[b'2'], 1)
            self.assertEqual(decoded[b'10'], 1)
            self.assertEqual(decoded[b'12'], 1)


class FoldMergeTests(unittest.TestCase):
    def setUp(self):
        import ast
        import numpy as np
        self.np = np
        path = MOTION.parent / 'labelfix/oof-scores.py'
        tree = ast.parse(path.read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        loop = next(n for n in main.body if isinstance(n, ast.For) and ast.unparse(n.target) == 'k')
        merge = next(n for n in loop.body if isinstance(n, ast.If) and ast.unparse(n.test) == 'a.merge')
        # Run the real merge validation/assignment, excluding I/O and loop-only continue.
        self.code = compile(ast.Module(body=merge.body[1:-1], type_ignores=[]), str(path), 'exec')
        self.meta = [('other-fold',), ('held-out',)]
        self.saved = {'ids': ['held-out'], 'vocab': ['tag'], 'folds': 2, 'epochs': 1,
                      'min_pos': 1, 'rows': self.meta, 'va': np.array([1]), 's': np.array([[.8]]), 'state': {}}

    def merge(self, saved=None, meta=None, fold=None):
        np = self.np
        meta = self.meta if meta is None else meta
        ns = {'np': np, 'sys': sys, 'd': self.saved if saved is None else saved, 'meta': meta,
              'fold': np.array([1, 0]) if fold is None else fold, 'k': 0, 'vocab': ['tag'],
              'a': types.SimpleNamespace(folds=2, epochs=1, min_pos=1),
              'S': np.zeros((len(meta), 1)), 'states': [], 'part': 'synthetic-fold'}
        exec(self.code, ns)
        return ns['S']

    def test_matching_fold_assigns_current_row(self):
        self.np.testing.assert_allclose(self.merge().ravel(), [0, .8])

    def test_other_fold_insertion_with_unchanged_validation_ids_is_rejected(self):
        with self.assertRaises(SystemExit):
            self.merge(meta=[('new-other-fold',)] + self.meta, fold=self.np.array([1, 1, 0]))

    def test_same_rows_with_stale_indices_are_rejected(self):
        with self.assertRaises(SystemExit):
            self.merge(saved={**self.saved, 'va': self.np.array([0])})

    def test_legacy_fold_without_full_rows_is_rejected(self):
        saved = dict(self.saved)
        del saved['rows']
        with self.assertRaises(SystemExit):
            self.merge(saved=saved)


if __name__ == '__main__':
    unittest.main()
