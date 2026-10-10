"""Offline checks for prep-cache.py: which files decide a source's cache key."""
import importlib.util
from pathlib import Path
import unittest


def load():
    spec = importlib.util.spec_from_file_location('prep_cache_test_subject', Path(__file__).with_name('prep-cache.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class DepsTests(unittest.TestCase):
    def setUp(self):
        self.pc = load()

    def test_follows_imports_and_named_files(self):
        self.assertEqual(self.pc.deps('prepare-iowa.py'),
                         ['iowa-judge-exclude.json', 'labelmap.py', 'labels_extra.py', 'prepare-extra.py', 'prepare-iowa.py'])
        self.assertIn('render.py', self.pc.deps('prepare-run9.py'))
        self.assertIn('medleydb-artists.json', self.pc.deps('prepare-rawstems.py'))
        self.assertIn('prepare-slakh.py', self.pc.deps('prepare-slakh-more.py'))

    def test_ignores_files_only_mentioned_in_prose(self):
        # prepare-run9.py's docstring and help text name stage-run9.py and run9-audit.py; neither changes its output.
        deps = self.pc.deps('prepare-run9.py')
        self.assertNotIn('stage-run9.py', deps)
        self.assertNotIn('run9-audit.py', deps)


if __name__ == '__main__':
    unittest.main()
