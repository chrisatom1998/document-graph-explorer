"""Offline regression tests for v2 source, carrier, and provenance safeguards.

Run: python -m unittest discover -s scripts/audio-model -p 'test_effect_pairs_v2.py'
"""
import ast
import csv
import hashlib
import tempfile
import sys
import io
import tarfile
import numpy as np
import soundfile as sf
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent / 'coverage/effects'))
import build_pairs_v2 as pairs


class PairSafetyTests(unittest.TestCase):
    def row(self, ident, source='vocalset', group=None):
        return dict(id=ident, source=source, group=group or ident, part='fixture',
                    file=f'audio-000.tar/{ident}.flac', tags='synth chord' if source == 'looperman' else 'voice',
                    licence='Looperman terms' if source == 'looperman' else 'CC BY 4.0',
                    creator=f'author-{ident}', url=f'https://example.invalid/{ident}',
                    seconds=5, pcm=ident, evidence='title: plain sound')

    def test_every_effect_title_is_excluded(self):
        for title in pairs.V2_TAGS + ['riser', 'rise', 'pulse', 'fall', 'vocal chopping']:
            with self.subTest(title=title):
                self.assertRegex(title, pairs.SKIP_TITLE)
        self.assertIsNone(pairs.SKIP_TITLE.search('warm sustained synth chord'))

    def test_partition_matches_preparation_hash(self):
        prep = Path(__file__).resolve().parent / 'prepare-run9.py'
        tree = ast.parse(prep.read_text())
        assignment = next(n for n in tree.body if isinstance(n, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == 'h' for t in n.targets))
        scope = {'hashlib': hashlib}
        exec(compile(ast.Module(body=[assignment], type_ignores=[]), str(prep), 'exec'), scope)
        for i in range(100):
            group = f'performer-{i}'
            self.assertEqual(pairs.validation_group(group), scope['h']('dge-run9-val', group) % 5 == 0)

    def test_carriers_unique_reserved_and_in_same_partition(self):
        source_rows = [self.row(f'vocal-{i}', group=f'singer-{i % 8}') for i in range(100)]
        source_rows += [self.row(f'pad-{i}', 'looperman', group=f'uploader-{i % 9}') for i in range(30)]
        source_rows += [dict(self.row('bad-title', 'looperman'), evidence='title: rising pulsing pad')]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'coverage/effect-pairs').mkdir(parents=True)
            (root / 'coverage/effect-pairs/plan.csv').write_text('id\n')
            args = SimpleNamespace(mdir=directory, out=str(root / 'plan.csv'))
            with patch.object(pairs, 'load_rows', return_value=source_rows), \
                 patch.object(pairs, 'TARGET', {t: 40 for t in pairs.V2_TAGS}):
                pairs.plan(args)
            with open(args.out) as f:
                rows = list(csv.DictReader(f))
        self.assertNotIn('bad-title', {r['id'] for r in rows})
        real = [r for r in rows if r['carrier_id']]
        self.assertGreater(len(real), 1)
        carrier_ids = [r['carrier_id'] for r in real]
        self.assertEqual(len(carrier_ids), len(set(carrier_ids)))
        self.assertTrue(set(carrier_ids).isdisjoint({r['id'] for r in rows}))
        for r in real:
            self.assertEqual(pairs.validation_group(r['group']), pairs.validation_group(r['carrier_group']))
            self.assertEqual(r['carrier_licence'], 'Looperman terms')
            self.assertTrue(r['carrier_creator'])
            self.assertTrue(r['carrier_url'])

    def test_render_writes_actual_carrier_provenance(self):
        row = dict(self.row('vocal'), effect='vocoder vocal', kind='vocal')
        carrier = self.row('pad', 'looperman', group=row['group'])
        row.update({f'carrier_{key}': value for key, value in carrier.items()})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'fixture').mkdir()
            t = np.arange(32000) / pairs.RATE
            with tarfile.open(root / 'fixture/audio-000.tar', 'w') as tar:
                for ident, samples in [('vocal', .2 * np.sin(2 * np.pi * 220 * t)),
                                       ('pad', .2 * np.sin(2 * np.pi * 110 * t) + .1 * np.sin(2 * np.pi * 550 * t))]:
                    audio = io.BytesIO()
                    sf.write(audio, samples, pairs.RATE, format='FLAC')
                    info = tarfile.TarInfo(f'{ident}.flac'); info.size = len(audio.getvalue())
                    tar.addfile(info, io.BytesIO(audio.getvalue()))
            plan = root / 'plan.csv'
            with plan.open('w') as f:
                writer = csv.DictWriter(f, list(row)); writer.writeheader(); writer.writerow(row)
            pairs.render(SimpleNamespace(plan=str(plan), src=str(root), out=str(root / 'out'), limit=0, workers=1))
            with (root / 'out/vocoder-vocal/manifest.csv').open() as f:
                result = {r['role']: r for r in csv.DictReader(f)}
            self.assertEqual(set(result), {'dry', 'wet'})
            self.assertEqual(result['wet']['licence_class'], 'restricted')
            self.assertEqual(result['wet']['carrier_id'], 'pad')
            self.assertEqual(result['wet']['carrier_licence'], 'Looperman terms')
            self.assertEqual(result['dry']['licence_class'], 'open')
            self.assertEqual(result['dry']['carrier_id'], '')
            self.assertEqual(result['dry']['group'], result['wet']['group'])

    def test_wet_records_both_licences_dry_and_fallback_do_not(self):
        row = self.row('vocal')
        carrier = self.row('pad', 'looperman')
        row.update({f'carrier_{key}': value for key, value in carrier.items()})
        settings = {'carrier_id': 'pad', 'carrier': 'real synth clip'}
        wet = pairs.provenance(row, 'wet', settings)
        self.assertEqual(wet['licence_class'], 'restricted')
        for key in ('licence', 'creator', 'url'):
            self.assertIn(row[key], wet[key])
            self.assertIn(carrier[key], wet[key])
            self.assertEqual(wet[f'carrier_{key}'], carrier[key])
        for role, used in [('dry', settings), ('wet', {'carrier': 'code-made'})]:
            clean = pairs.provenance(row, role, used)
            self.assertEqual(clean['licence_class'], 'open')
            self.assertEqual(clean['licence'], row['licence'])
            self.assertTrue(all(not clean[k] for k in pairs.CARRIER_COLS))


if __name__ == '__main__':
    unittest.main()
