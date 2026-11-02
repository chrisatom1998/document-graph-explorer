"""Offline adapter startup tests; no model dependencies or weights required."""
import builtins
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


class ModelImportReached(Exception):
    """Stop before importing or executing any model code."""


class RunModelEnvironmentTest(unittest.TestCase):
    def test_enforces_environment_before_model_imports(self):
        real_import = builtins.__import__
        for model in ('peace', 'tp-clap'):
            for inherited in ({}, {'HF_HUB_OFFLINE': '0',
                                   'TRANSFORMERS_OFFLINE': '0', 'OMP_NUM_THREADS': '99'}):
                with self.subTest(model=model, inherited=inherited), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    manifest = root / 'manifest.json'
                    manifest.write_text(json.dumps({'version': 'dge-research-v1', 'clips': []}))
                    checkpoint = root / 'checkpoint'
                    checkpoint.touch()
                    observed = {}

                    def intercept_import(name, *args, **kwargs):
                        if name == 'numpy':
                            observed.update({key: os.environ.get(key) for key in
                                             ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'OMP_NUM_THREADS')})
                            raise ModelImportReached()
                        return real_import(name, *args, **kwargs)

                    argv = ['run-model.py', str(manifest), str(root / 'output.json'),
                            '--model', model, '--checkpoint', str(checkpoint),
                            '--revision', 'test', '--threads', '2']
                    with patch.dict(os.environ, inherited, clear=True), \
                            patch('sys.argv', argv), \
                            patch('importlib.metadata.version', return_value='test'), \
                            patch('builtins.__import__', side_effect=intercept_import):
                        with self.assertRaises(ModelImportReached):
                            runpy.run_path(str(Path(__file__).with_name('run-model.py')), run_name='__main__')
                    self.assertEqual(observed, {'HF_HUB_OFFLINE': '1',
                                                'TRANSFORMERS_OFFLINE': '1', 'OMP_NUM_THREADS': '2'})


if __name__ == '__main__':
    unittest.main()
