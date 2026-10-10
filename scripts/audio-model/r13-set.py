"""Round 13: prepare one staged set (empty-tags/v1 layout) with prepare-run9.py, train rows only, from a keep list.

Usage: python3 scripts/audio-model/r13-set.py <staged-dir> <out-dir> <prefix> <keep csv> [--workers 6]
  Runs prepare-run9.py <staged-dir> <out-dir> --prefix <prefix> --no-renders --audit <keep csv>. The keep csv (part, id, keep,
  tags) lists only train rows that passed the test-leak filter in the project container. A set with no Freesound rows (synth
  presets, effect pairs) leaves <prefix>fs9 empty; prepare-run9.py cannot write an empty output, so this lets it skip that
  file (no <prefix>fs9-mel.npy is written) and hf-job.sh only passes the outputs that exist.
"""
import os, runpy, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_memmap, _open_memmap = np.memmap, np.lib.format.open_memmap


class _Empty(np.ndarray):
    def flush(self): pass


def memmap(path, *a, shape=None, **k):
    if shape is not None and shape[0] == 0: return np.zeros(shape, k.get('dtype', a[0] if a else np.float16)).view(_Empty)
    return _memmap(path, *a, shape=shape, **k)


def open_memmap(path, *a, shape=None, **k):
    if shape is not None and shape[0] == 0: return np.zeros(shape, k.get('dtype', np.float16)).view(_Empty)   # nothing written
    return _open_memmap(path, *a, shape=shape, **k)


def main():
    staged, out, prefix, keep, *rest = sys.argv[1:]
    np.memmap, np.lib.format.open_memmap = memmap, open_memmap
    sys.argv = ['prepare-run9.py', staged, out, '--prefix', prefix, '--no-renders', '--audit', keep, *rest]
    runpy.run_path(os.path.join(HERE, 'prepare-run9.py'), run_name='__main__')
    for n in (f'{prefix}fs9', f'{prefix}ls9'):   # an empty output keeps no files, so it is never passed to training
        if not os.path.exists(os.path.join(out, f'{n}-mel.npy')):
            j = os.path.join(out, f'{n}.json')
            if os.path.exists(j): os.remove(j)
            print(f'{n}: empty, skipped', flush=True)


if __name__ == '__main__':
    main()
