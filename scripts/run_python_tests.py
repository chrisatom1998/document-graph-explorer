#!/usr/bin/env python3
"""Run every Python test file under scripts/. Used by `npm run test:python` and the CI job `python checks`.

Each test file is a standalone script (it finds the modules beside it on its own), so each runs in its own process,
the same way a person runs one: `python3 scripts/dj-effects/test_rescore.py`.

Needs only NumPy (scripts/requirements-dev.txt). A file that needs more is listed below and is skipped, and said to be
skipped, when what it needs is not there. A new test file is picked up by its name: test_*.py, or scripts/test-*.py.

Usage: python3 scripts/run_python_tests.py [--list]
"""
import importlib.util
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_S = 180

# Extra Python packages a test file imports. It runs when all of them are installed.
NEEDS_MODULES = {
    'scripts/audio-model/test_effect_pairs_v2.py': ['scipy', 'soundfile', 'pedalboard'],
}

# Tests of the local review server. They start the app's own Node tooling (vite-node) to classify audio and unpack
# archives with the machine's tar program, and they fail on a machine with only Python and NumPy. Run them by hand on
# a machine set up for the app: python3 scripts/test-dj-review-server.py
NEEDS_APP_SETUP = {
    'scripts/test-dj-pack-import.py',
    'scripts/test-dj-review-server.py',
    'scripts/test-dj-song-upload.py',
}


def find_tests():
    found = set(ROOT.glob('scripts/**/test_*.py')) | set(ROOT.glob('scripts/test-*.py'))
    return sorted(p.relative_to(ROOT).as_posix() for p in found if '__pycache__' not in p.parts)


def skip_reason(test):
    if test in NEEDS_APP_SETUP:
        return 'needs the app set up locally (see NEEDS_APP_SETUP in this file)'
    missing = [m for m in NEEDS_MODULES.get(test, []) if importlib.util.find_spec(m) is None]
    if missing:
        return 'not installed: ' + ', '.join(missing)
    return None


def main():
    tests = find_tests()
    if '--list' in sys.argv[1:]:
        for test in tests:
            reason = skip_reason(test)
            print(f'{test}  (skipped: {reason})' if reason else test)
        return 0
    if not tests:
        print('No Python test files found under scripts/. That is a mistake in this runner, not a pass.')
        return 1
    stale = sorted((set(NEEDS_MODULES) | NEEDS_APP_SETUP) - set(tests))
    if stale:
        print('Listed in run_python_tests.py but no longer in the repository: ' + ', '.join(stale))
        return 1

    passed, skipped, failed = [], [], []
    for test in tests:
        reason = skip_reason(test)
        if reason:
            skipped.append(test)
            print(f'SKIP  {test}  ({reason})')
            continue
        started = time.monotonic()
        try:
            run = subprocess.run([sys.executable, test], cwd=ROOT, capture_output=True, text=True, timeout=TIMEOUT_S)
            ok, output = run.returncode == 0, run.stdout + run.stderr
        except subprocess.TimeoutExpired as late:
            ok = False
            output = f'{late.stdout or ""}{late.stderr or ""}\nStopped after {TIMEOUT_S} s.'
        took = time.monotonic() - started
        if ok:
            passed.append(test)
            print(f'ok    {test}  ({took:.1f} s)')
        else:
            failed.append(test)
            print(f'FAIL  {test}  ({took:.1f} s)')
            print('      ' + output.strip().replace('\n', '\n      '))

    print(f'\n{len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped, of {len(tests)} Python test files.')
    if failed:
        print('Failed: ' + ', '.join(failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
