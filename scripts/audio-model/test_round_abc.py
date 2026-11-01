"""Offline checks for the round A/B/C staging code (round_abc.py, stage-guitarfx.py, stage-birds.py, prepare-staged.py,
ced-check-keys-breaks.py). No network, no Hugging Face, no GPU. Run: python3 -m unittest test_round_abc (needs numpy)."""
import csv, importlib.util, json, os, re, unittest
from pathlib import Path

import round_abc as R

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_')[:-3], HERE / name)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def row(**kw):
    base = {'id': 'x', 'dataset': 'test', 'group': 'g', 'split': 'train', 'tags': '', 'absent': '', 'pcm_sha256': 'p'}
    return {**base, **kw}


EMPTY_EX = {k: set() for k in R.EXCLUSION_KEYS}


def free_user(prefix='u'):
    """An uploader name no hash rule holds out (synth_held, fs_test)."""
    for i in range(1000):
        u = f'{prefix}{i}'
        if not R.synth_held(u) and not R.fs_test(u): return u


class SplitTests(unittest.TestCase):
    def test_group_split_is_stable_and_near_the_asked_share(self):
        groups = [f'g{i}' for i in range(4000)]
        a = [R.group_split(g, 's', 15, 10) for g in groups]
        self.assertEqual(a, [R.group_split(g, 's', 15, 10) for g in groups])
        held = a.count('heldout') / len(a)
        self.assertGreater(held, 0.12); self.assertLess(held, 0.18)
        self.assertNotEqual(a, [R.group_split(g, 'other salt', 15, 10) for g in groups])

    def test_check_groups_refuses_a_group_on_both_sides(self):
        ok = [row(group='a', split='train'), row(group='a', split='val'), row(group='b', split='heldout')]
        self.assertEqual(R.check_groups(ok), 2)
        with self.assertRaises(SystemExit): R.check_groups(ok + [row(group='a', split='heldout')])


class DedupTests(unittest.TestCase):
    def test_same_audio_in_two_groups_is_dropped_from_both(self):
        d = R.Dedup()
        self.assertIsNone(d.add('s1', 'a', 'train'))
        self.assertEqual(d.add('s1', 'a', 'train'), 'duplicate audio')
        self.assertIsNone(d.add('s2', 'b', 'heldout'))
        self.assertEqual(d.add('s2', 'c', 'train'), 'duplicate audio in another group')
        rows = [row(id='1', pcm_sha256='s1'), row(id='2', pcm_sha256='s2', group='b', split='heldout')]
        self.assertEqual([r['id'] for r in R.drop_conflicts(rows, d)], ['1'])


class IdmtTests(unittest.TestCase):
    def test_parse_and_guitar(self):
        p = R.idmt_parse('Gitarre monophon/Samples/Distortion/G81-60501-3323-31566.wav')
        self.assertEqual((p['kind'], p['setting'], p['effect'], p['note']), ('G', 8, 'Distortion', '60501'))
        self.assertEqual(R.idmt_guitar(8), 'guitar-2'); self.assertEqual(R.idmt_guitar(7), 'guitar-1')
        self.assertEqual(R.idmt_parse('Bass monophon/Samples/NoFX/B11-28100-1111-00001.wav')['kind'], 'B')
        self.assertIsNone(R.idmt_parse('Gitarre monophon/Samples/NoFX/readme.txt'))
        with self.assertRaises(ValueError): R.idmt_guitar(1)

    def test_drive_labels_follow_egfxset(self):
        pres, absn = R.idmt_labels('Distortion')
        self.assertIn('distorted', pres); self.assertNotIn('saturated', absn); self.assertNotIn('saturated', pres)
        pres, absn = R.idmt_labels('Overdrive')
        self.assertIn('saturated', pres); self.assertNotIn('distorted', absn)
        pres, absn = R.idmt_labels('Phaser')
        for t in ('chorused', 'flanged'): self.assertNotIn(t, absn)
        self.assertIn('distorted', absn)
        pres, absn = R.idmt_labels('NoFX')
        self.assertEqual(set(pres), {'dry', 'guitar', 'electric guitar'}); self.assertIn('distorted', absn)

    def test_every_effect_folder_is_mapped_and_tags_exist(self):
        import labelmap as L, labels_extra as E
        known = set(L.CAT) | set(E.EXTRA_CAT)
        pres, absn = R.idmt_labels('EQ')
        self.assertEqual(pres, ['electric guitar', 'guitar'])
        self.assertNotIn('dry', absn); self.assertIn('distorted', absn); self.assertIn('echoing', absn)
        # every effect folder found in the four guitar zips on 2026-10-31 has a mapping
        seen = {'NoFX', 'EQ', 'Chorus', 'Flanger', 'FeedbackDelay', 'Distortion', 'Vibrato', 'Reverb', 'Phaser',
                'SlapbackDelay', 'Tremolo', 'Overdrive'}
        self.assertEqual(seen, set(R.IDMT_EFFECT))
        for fx in R.IDMT_EFFECT:
            pres, absn = R.idmt_labels(fx)
            self.assertFalse(set(pres) & set(absn))
            self.assertLessEqual(set(pres) | set(absn), known, fx)
        for inst in R.MEDLEY:
            pres, absn = R.medley_labels(inst)
            self.assertFalse(set(pres) & set(absn)); self.assertLessEqual(set(pres) | set(absn), known, inst)
        for hb in (0, 1): self.assertLessEqual(set(sum(R.bird_labels(hb), [])), known)

    def test_guitar_two_is_held_out_and_notes_stay_together(self):
        g = load('stage-guitarfx.py')
        held = {8, 9}
        mk = lambda s, fx, note='60501': R.idmt_parse(f'Gitarre monophon/Samples/{fx}/G{s}1-{note}-3323-31566.wav')
        self.assertEqual(g.idmt_split(mk(8, 'NoFX'), held), 'heldout')
        self.assertEqual(g.idmt_split(mk(9, 'Chorus'), held), 'heldout')
        for note in ('40100', '40200', '50300', '60501', '61200'):
            self.assertEqual(len({g.idmt_split(mk(6, fx, note), held) for fx in R.IDMT_EFFECT}), 1)
        self.assertFalse(g.idmt_keep(mk(8, 'Overdrive'), 'heldout'))
        self.assertTrue(g.idmt_keep(mk(6, 'Distortion'), 'train'))

    def test_cap_keeps_lowest_hash_per_effect(self):
        g = load('stage-guitarfx.py')
        cands = [(('train', 'Chorus', b, 2), f'c{b}') for b in (5, 1, 9)] + [(('train', 'Reverb', 3, 2), 'r3')]
        self.assertEqual(sorted(g.cap(cands)), ['c1', 'c5', 'r3'])


class MedleyTests(unittest.TestCase):
    def test_rule_on_a_small_table(self):
        g = load('stage-guitarfx.py')
        meta = [{'subset': 'test', 'song_id': f'{s:03d}', 'instrument': 'flute'} for s in range(10) for _ in range(s + 1)]
        meta += [{'subset': 'training', 'song_id': '999', 'instrument': 'flute'}]
        held = g.medley_heldout(meta)
        self.assertNotIn('999', held); self.assertGreaterEqual(len(held), 2)
        self.assertGreaterEqual(sum(int(s) + 1 for s in held), 0.3 * 55)
        self.assertEqual(held, g.medley_heldout(list(reversed(meta))))

    def test_committed_list_matches_the_real_metadata(self):
        p = '/tmp/msdb-meta.csv'
        if not os.path.exists(p): self.skipTest('Medley-solos-DB metadata not downloaded')
        g = load('stage-guitarfx.py')
        res = json.load(open(HERE.parent.parent / 'docs/evaluations/distorted-heldout-2026-10-31/reserved-test-families.json'))
        self.assertEqual(g.medley_heldout(list(csv.DictReader(open(p)))), sorted(res['medleySolosHeldoutSongIds']))


class ReservedTests(unittest.TestCase):
    def setUp(self): self.res = R.reserved_lists()

    def test_new_sets_are_reserved(self):
        files = self.res['_files']
        for s in ('distorted-heldout-2026-10-31', 'bird-heldout-2026-10-31', 'keys-breaks-heldout-2026-10-31'):
            self.assertIn(f'docs/evaluations/{s}/reserved-test-families.json', files)
            self.assertIn(s, R.forbidden_set_names())
        self.assertEqual(self.res['idmtAudioEffectsHeldoutInstrumentSettings'], {8, 9})
        self.assertTrue({'025', '026', '027'} <= self.res['medleySolosHeldoutSongIds'])
        self.assertIn('idmt-bass', R.forbidden_set_names())

    def test_reserved_groups_cannot_train(self):
        for g in ('idmt-guitar-2', 'medley-song:025'):
            self.assertTrue(R.reserved_group(row(group=g), self.res))
            with self.assertRaises(SystemExit): R.assert_reserved_held([row(group=g, split='val')], self.res)
            R.assert_reserved_held([row(group=g, split='heldout')], self.res)
        self.assertFalse(R.reserved_group(row(group='idmt-guitar-1'), self.res))
        rule = json.load(open(HERE.parent.parent / 'docs/evaluations/bird-heldout-2026-10-31/reserved-test-families.json'))['birdHeldoutRule']
        held = next(f'warblr:{i}' for i in range(1000) if R.bucket(rule['salt'], f'warblr:{i}') < rule['heldPct'])
        with self.assertRaises(SystemExit): R.assert_reserved_held([row(group=held, dataset='warblr10k')], self.res)
        # The bird rule only applies to bird rows.
        self.assertFalse(R.reserved_group(row(group=held, dataset='other'), self.res))

    def test_bird_split_agrees_with_the_reserved_rule(self):
        b = load('stage-birds.py')
        for i in range(500):
            g = f'freesound-user:u{i}'
            self.assertEqual(b.bird_split(g) == 'heldout', R.reserved_group(row(group=g, dataset='ff1010bird'), self.res))

    def test_keys_breaks_rule_matches_the_script(self):
        c = load('ced-check-keys-breaks.py')
        rule = json.load(open(HERE.parent.parent / 'docs/evaluations/keys-breaks-heldout-2026-10-31/reserved-test-families.json'))['keysBreaksHeldoutRule']
        self.assertEqual(c.SALT, rule['salt'])
        self.assertRegex(Path(HERE / 'ced-check-keys-breaks.py').read_text(), rf"<\s*{rule['heldPct']}\b")


class FreesoundTests(unittest.TestCase):
    def test_reasons_in_order(self):
        u = free_user()
        ex = {k: set() for k in R.EXCLUSION_KEYS}
        self.assertEqual(R.freesound_reason(1, None, ex, 'train'), 'no uploader metadata')
        self.assertIsNone(R.freesound_reason(1, u, ex, 'train'))
        ex['fsd_dev'].add(1)
        self.assertIsNone(R.freesound_reason(1, u, ex, 'train'))
        self.assertIsNotNone(R.freesound_reason(1, u, ex, 'heldout'))   # already trained elsewhere: not a fresh test clip
        for key, why in (('held_users', 'uploader has a held-out clip in another set'), ('reserved_users', 'reserved test uploader')):
            e = {k: set() for k in R.EXCLUSION_KEYS}; e[key].add(u)
            self.assertEqual(R.freesound_reason(2, u, e, 'train'), why)
        e = {k: set() for k in R.EXCLUSION_KEYS}; e['fsd_eval'].add(3); e['reserved_users'].add(u)
        self.assertEqual(R.freesound_reason(3, u, e, 'train'), 'FSD50K eval')
        held_user = next(f'v{i}' for i in range(1000) if R.synth_held(f'v{i}'))
        self.assertEqual(R.freesound_reason(4, held_user, EMPTY_EX, 'train'), 'reserved test uploader')

    def test_manifest_refs_reads_every_id_style(self):
        rows = [{'url': 'https://freesound.org/people/alice/sounds/11/', 'split': 'train'},
                {'id': 'fsnew:12', 'username': 'bob', 'split': 'heldout'},
                {'id': 'ff1010bird:13', 'group': 'freesound-user:carol', 'split': 'heldout'},
                {'id': '14', 'split': 'val'},
                {'id': 'warblr10k:abc', 'group': 'warblr:abc', 'split': 'heldout'}]
        ids, hid, hus = R.manifest_refs(rows)
        self.assertEqual(ids, {11, 12, 13, 14}); self.assertEqual(hid, {12, 13}); self.assertEqual(hus, {'bob', 'carol'})

    def test_ff1010_groups_by_uploader(self):
        b = load('stage-birds.py')
        u = free_user('w')
        plan = b.plan_ff1010([{'itemid': '5', 'hasbird': '1'}, {'itemid': '6', 'hasbird': '0'}, {'itemid': '7', 'hasbird': '1'}],
                             {5: u, 6: u}, EMPTY_EX)
        self.assertEqual(plan[0][2], f'freesound-user:{u}'); self.assertEqual(plan[0][1], plan[1][1])
        self.assertEqual(plan[2][2], 'freesound-sound:7'); self.assertEqual(plan[2][3], 'no uploader metadata')


class EvalAndLabelTests(unittest.TestCase):
    def test_eval_pick_balances(self):
        rows = [row(id=f'p{i}', tags='distorted', split='heldout') for i in range(10)] + \
               [row(id=f'n{i}', absent='distorted', split='heldout') for i in range(50)]
        got = R.eval_pick(rows, 'distorted', 12)
        self.assertEqual(sum(r['id'].startswith('p') for r in got), 6); self.assertEqual(len(got), 12)
        self.assertEqual(got, R.eval_pick(list(reversed(rows)), 'distorted', 12))
        self.assertEqual(sum(r['id'].startswith('p') for r in R.eval_pick(rows, 'distorted', 100)), 10)

    def test_prepare_staged_labels(self):
        ps = load('prepare-staged.py')
        self.assertEqual(ps.item_labels(row(tags='distorted;guitar', absent='dry')), {'cat:distorted': 1.0, 'cat:guitar': 1.0, 'cat:dry': 0.0})
        with self.assertRaises(SystemExit): ps.item_labels(row(tags='dry', absent='dry'))


class CedTests(unittest.TestCase):
    def setUp(self): self.c = load('ced-check-keys-breaks.py')

    def test_candidate_tags(self):
        self.assertEqual(self.c.candidate_tags('rhodes,keys,chords'), ['electric piano'])
        self.assertEqual(self.c.candidate_tags(['Rhodes', 'organ']), [])
        self.assertIn('breakbeat', self.c.candidate_tags('breakbeat amen'))
        self.assertEqual(self.c.candidate_tags('piano grand'), [])

    def test_verdict(self):
        rules = {'confirm_min': 0.3, 'reject_max': 0.5, 'reject_classes': [0, 1, 2, 3, 4, 5, 72, 300]}
        p = [0.0] * 527; p[154] = 0.6
        self.assertEqual(self.c.verdict(p, 'electric piano', rules)[2], 'confirmed')
        p[0] = 0.7
        self.assertEqual(self.c.verdict(p, 'electric piano', rules)[2], 'rejected: speech/animal/vehicle')
        q = [0.0] * 527; q[163] = 0.1
        self.assertTrue(self.c.verdict(q, 'breakbeat', rules)[2].startswith('rejected: listener'))


class JobWiringTests(unittest.TestCase):
    def test_main_cache_key_ignores_prepare_staged(self):
        sh = (HERE / 'hf-job.sh').read_text()
        key_line = next(l for l in sh.splitlines() if 'grep -v' in l and 'prepare' in l)
        self.assertIn('-e prepare-staged.py', key_line)
        self.assertIn('BIRDS_DATA', sh); self.assertIn('GUITARFX_DATA', sh)

    def test_stage_job_never_trains(self):
        sh = (HERE / 'hf-stage-job.sh').read_text()
        self.assertNotRegex(sh, r'train\.py')
        self.assertIn('REPO_SHA', sh)
        allowed = set(re.findall(r'stage-birds\.py|stage-guitarfx\.py|ced-check-keys-breaks\.py', sh))
        self.assertEqual(allowed, {'stage-birds.py', 'stage-guitarfx.py', 'ced-check-keys-breaks.py'})


if __name__ == '__main__':
    unittest.main()
