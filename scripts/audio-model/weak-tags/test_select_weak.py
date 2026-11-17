import csv, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import select_weak as s


def row(tag, fid, user, score='0.9'):
    return {'tag': tag, 'freesound_id': str(fid), 'username': user, 'license': '0', 'seconds': '3', 'score': score}


class SelectWeak(unittest.TestCase):
    def setUp(self):
        self.blocks = {'eval clip': ({1}, set()), 'eval uploader': (set(), {'judgeuser'}), 'listed': ({2}, set())}

    def test_drops_held_out_before_caps(self):
        rows = [row('bell', 1, 'a'), row('bell', 3, 'JudgeUser'), row('bell', 2, 'b'), row('bell', 4, 'c', '0.4'),
                row('bell', 5, 'c'), row('piano', 6, 'c')]
        kept, drops = s.select(rows, {'bell'}, self.blocks)
        self.assertEqual([r['freesound_id'] for r in kept], ['5'])
        self.assertEqual(drops[('bell', 'eval clip')], 1)
        self.assertEqual(drops[('bell', 'eval uploader')], 1)   # case-folded
        self.assertEqual(drops[('bell', 'listed')], 1)
        self.assertEqual(drops[('bell', 'CED score < 0.5')], 1)

    def test_uploader_cap_keeps_best_scores(self):
        rows = [row('bell', 100 + i, 'u', f'0.{50 + i}') for i in range(s.PER_UPLOADER + 3)]
        kept, drops = s.select(rows, {'bell'}, {})
        self.assertEqual(len(kept), s.PER_UPLOADER)
        self.assertEqual(drops[('bell', 'uploader cap')], 3)
        self.assertEqual(min(float(r['score']) for r in kept), 0.53)

    def test_listed_formats(self):
        d = tempfile.mkdtemp()
        p = lambda n, t: (open(os.path.join(d, n), 'w').write(t), os.path.join(d, n))[1]
        self.assertEqual(s.listed_ids(p('a.txt', 'bell\ttrain\tmined\t1,2,a\n')), {1, 3, 13})
        self.assertEqual(s.listed_ids(p('b.tsv', 'bell\ttrain\t7:ab,8\n')), {7, 8})
        self.assertEqual(s.listed_ids(p('c.csv', 'tag,freesound_id,username\nbell,9,x\n')), {9})
        self.assertEqual(s.listed_ids(p('d.txt', 'freesound:11\nlooperman:5\n')), {11})

    def test_weak_tags_reads_f1(self):
        d = tempfile.mkdtemp(); f = os.path.join(d, 'p.csv')
        with open(f, 'w', newline='') as h:
            w = csv.writer(h); w.writerow(['tag', 'f1']); w.writerow(['bell', '0.42']); w.writerow(['kick', '0.8']); w.writerow(['foley', ''])
        self.assertEqual(s.weak_tags(f), ['bell', 'foley'])


if __name__ == '__main__':
    unittest.main()
