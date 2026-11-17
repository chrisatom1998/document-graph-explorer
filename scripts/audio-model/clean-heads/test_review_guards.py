"""Offline tests: no model initialization, private audio, downloads, or evaluation jobs."""
import ast
import hashlib
from pathlib import Path
import struct
import unittest


def load_function(filename, name):
    source = Path(__file__).with_name(filename).read_text()
    tree = ast.parse(source)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    namespace = {'N': 480000, 'hashlib': hashlib, 'struct': struct}
    exec(compile(ast.Module(body=[function], type_ignores=[]), filename, 'exec'), namespace)
    return namespace[name]


class CoefficientTests(unittest.TestCase):
    def test_digest_covers_bias_and_every_weight(self):
        digest = load_function('fair-judge.py', 'coefficient_digest')
        head = {'bias': 0.25, 'weights': [1.0, 2.0, 3.0]}
        original = digest(head)
        self.assertEqual(original, hashlib.sha256(struct.pack('>4d', .25, 1, 2, 3)).hexdigest())
        self.assertNotEqual(original, digest({**head, 'bias': .5}))
        for index in range(3):
            weights = head['weights'].copy()
            weights[index] += .1
            self.assertNotEqual(original, digest({**head, 'weights': weights}))
        # This different vector collides under the old weighted-sum checksum.
        self.assertNotEqual(original, digest({**head, 'weights': [3.0, 1.0, 3.0]}))


if __name__ == '__main__':
    unittest.main()
