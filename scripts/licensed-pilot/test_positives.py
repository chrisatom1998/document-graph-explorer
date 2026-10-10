"""Label rules of positives_from_mirror.py: python3 -I scripts/licensed-pilot/test_positives.py."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from positives_from_mirror import label

ROW = {'ced_bass_guitar': .8, 'ced_impact': .7, 'ced_impact_class': 'Slam', 'ced_double_bass': .1, 'ced_electric_guitar': .1,
       'ced_other': .7, 'ced_drums': .8}

def call(kind, text):
    return label({**ROW, 'kind': kind}, {'text': text})[0]

class LabelRules(unittest.TestCase):
    def test_bass_guitar_needs_a_bass_word_and_no_other_bass(self):
        self.assertEqual(call('bass guitar', 'walking jazz bass electric'), {'bass guitar': 1, 'foley hit': 0})
        self.assertIsNone(call('bass guitar', 'funky groove'))
        for text in ['808 bass hit', 'upright double bass pizz', 'synth bass wobble', 'bass drum kick', 'bass clarinet low note']:
            with self.subTest(text=text):
                self.assertIsNone(call('bass guitar', text))

    def test_foley_hit_needs_an_impact_word_and_no_music(self):
        self.assertEqual(call('foley hit', 'door slam foley'), {'bass guitar': 0, 'foley hit': 1})
        self.assertEqual(call('foley hit', 'screen door hit percussion found'), {'bass guitar': 0, 'foley hit': 1})
        self.assertIsNone(call('foley hit', 'snare hit drum'))
        self.assertIsNone(call('foley hit', 'birds chirping'))

    def test_negatives_never_name_a_bass_guitar(self):
        self.assertEqual(call('hard negative', '808 sub bass')['bass guitar'], 0)
        self.assertIsNone(call('hard negative', 'fender jazz bass guitar'))
        self.assertEqual(call('drum negative', 'drum loop 120 bpm')['bass guitar'], 0)
        self.assertIsNone(call('drum negative', 'drum and bass loop'))

if __name__ == '__main__':
    unittest.main()
