#!/usr/bin/env python3
"""Put archived evaluation data back under docs/evaluations/.

The large data files of finished experiments (clip lists, feature files, per-clip results) live in a private Hugging
Face dataset, not in this repository. docs/evaluations/archived-files.json lists every one with its size and SHA-256.
The app, its tests and the running workflows read none of them; an old experiment script that does needs this first.

Usage:
  python3 scripts/fetch-evaluation-archive.py                 every archived file
  python3 scripts/fetch-evaluation-archive.py key-2026-10-06  only that folder (name as many as you like)
  python3 scripts/fetch-evaluation-archive.py --list          what is archived, nothing downloaded

Needs HF_TOKEN set to a token that can read the dataset. Only the Python standard library is used. A file already in
place with the right checksum is left alone; a download whose checksum is wrong is not written. Restored files are
ignored by git (docs/evaluations/.gitignore), so they are not committed back by accident.
"""
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVALUATIONS = ROOT / 'docs' / 'evaluations'


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    archive = json.loads((EVALUATIONS / 'archived-files.json').read_text())
    args = sys.argv[1:]
    wanted = [a.strip('/') for a in args if not a.startswith('--')]
    files = [f for f in archive['files'] if not wanted or f['path'].split('/')[0] in wanted]
    unknown = sorted(set(wanted) - {f['path'].split('/')[0] for f in archive['files']})
    if unknown:
        print('No archived files under: ' + ', '.join(unknown) + '. Run with --list to see the folders.')
        return 1
    if '--list' in args:
        for f in files:
            print(f"{f['bytes'] / 1048576:6.1f} MB  {f['path']}")
        print(f"{len(files)} files, {sum(f['bytes'] for f in files) / 1048576:.1f} MB, in {archive['dataset']}")
        return 0
    token = os.environ.get('HF_TOKEN')
    if not token:
        print(f"Set HF_TOKEN to a Hugging Face token that can read the private dataset {archive['dataset']}.")
        return 1

    fetched = kept = 0
    for f in files:
        target = EVALUATIONS / f['path']
        if target.is_file() and sha256(target.read_bytes()) == f['sha256']:
            kept += 1
            continue
        url = (f"https://huggingface.co/datasets/{archive['dataset']}/resolve/{archive['revision']}/"
               + urllib.parse.quote(f['path']))
        request = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read()
        except OSError as error:
            print(f"Could not download {f['path']}: {error}")
            return 1
        if sha256(data) != f['sha256']:
            print(f"Checksum mismatch for {f['path']}; nothing written for it. Stopping.")
            return 1
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        fetched += 1
        print(f"fetched  {f['path']}")
    print(f'{fetched} downloaded, {kept} already in place, of {len(files)} files.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
