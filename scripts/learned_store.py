"""Read and write the split learned-head model.

Each linear head is one file, ``public/sound-model/heads/<slug>.json`` (sorted keys, one line).
``learned.json`` is the envelope: version, encoder, revision, examples, and the head order
(one slug per line). Neighbour heads live in ``public/sound-model/neighbours/``.
``head-sha256.txt`` lists ``slug <sha256>`` (and ``neighbour/<slug> <sha256>``), sorted, so two
head edits do not share a line. The whole-file ``manifest.json`` pin is not written: the app
stamps integrity from ``head-sha256.txt`` at build time.

A monolithic ``learned.json`` (heads as objects) still loads, so older exports and tests keep working.
``write_learned`` always writes the split layout.

Usage: python3 scripts/learned_store.py write <model.json> [dest learned.json]
       python3 scripts/learned_store.py split [learned.json]
"""
import hashlib
import json
import re
import sys
from pathlib import Path

SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


def slug(label):
    text = re.sub(r'[^a-z0-9]+', '-', str(label).strip().lower()).strip('-')
    if not SLUG.fullmatch(text):
        raise SystemExit(f'cannot name a head file for {label!r}')
    return text


def _head_bytes(head):
    return json.dumps(head, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n'


def _is_split(raw):
    heads = raw.get('heads') or []
    return all(isinstance(item, str) for item in heads)


def load_learned(path='public/sound-model/learned.json'):
    """Return the in-memory model: heads are objects, whether or not the file is split."""
    path = Path(path)
    raw = json.loads(path.read_text())
    if not _is_split(raw):
        return raw
    root = path.parent
    heads = []
    for name in raw.get('heads') or []:
        heads.append(json.loads((root / 'heads' / f'{name}.json').read_text()))
    model = {
        'version': raw['version'],
        'encoder': raw['encoder'],
        'revision': raw['revision'],
        'examples': raw.get('examples') or [],
        'heads': heads,
    }
    neighbours = raw.get('neighbours')
    if neighbours:
        background = json.loads((root / 'neighbours' / f"{neighbours['background']}.json").read_text())
        model['neighbours'] = {
            'k': neighbours['k'],
            'background': background['background'],
            'heads': [json.loads((root / 'neighbours' / f'{name}.json').read_text()) for name in neighbours['heads']],
        }
    return model


def _format_index(model, slugs, neighbour_index):
    lines = [
        '{',
        f'  "version": {json.dumps(model["version"])},',
        f'  "encoder": {json.dumps(model["encoder"], ensure_ascii=False)},',
        f'  "revision": {json.dumps(model["revision"], ensure_ascii=False)},',
    ]
    examples = model.get('examples') or []
    if examples:
        dumped = json.dumps(examples, ensure_ascii=False, sort_keys=True, indent=2).replace('\n', '\n  ')
        lines.append(f'  "examples": {dumped},')
    else:
        lines.append('  "examples": [],')
    lines.append('  "heads": [')
    for index, name in enumerate(slugs):
        comma = ',' if index < len(slugs) - 1 or neighbour_index else ''
        lines.append(f'    {json.dumps(name)}{comma}')
    if neighbour_index:
        lines.append('  ],')
        lines.append('  "neighbours": {')
        lines.append(f'    "k": {json.dumps(neighbour_index["k"])},')
        lines.append(f'    "background": {json.dumps(neighbour_index["background"])},')
        names = neighbour_index['heads']
        lines.append('    "heads": [')
        for index, name in enumerate(names):
            comma = ',' if index < len(names) - 1 else ''
            lines.append(f'      {json.dumps(name)}{comma}')
        lines.append('    ]')
        lines.append('  }')
    else:
        lines.append('  ]')
    lines.append('}')
    return '\n'.join(lines) + '\n'


def write_learned(path, model):
    """Write the split model. Returns the sha256 of ``head-sha256.txt``."""
    path = Path(path)
    root = path.parent
    heads_dir = root / 'heads'
    neighbours_dir = root / 'neighbours'
    heads_dir.mkdir(parents=True, exist_ok=True)
    slugs = []
    used = set()
    for head in model.get('heads') or []:
        name = slug(head['label'])
        if name in used:
            raise SystemExit(f'duplicate head slug {name} ({head["label"]!r})')
        used.add(name)
        slugs.append(name)
        (heads_dir / f'{name}.json').write_text(_head_bytes(head))
    for stale in heads_dir.glob('*.json'):
        if stale.stem not in used:
            stale.unlink()
    neighbour_index = None
    keep_neighbours = set()
    neighbours = model.get('neighbours')
    if neighbours:
        neighbours_dir.mkdir(parents=True, exist_ok=True)
        background = {'background': neighbours['background']}
        (neighbours_dir / 'background.json').write_text(_head_bytes(background))
        keep_neighbours.add('background')
        names = []
        for head in neighbours.get('heads') or []:
            name = slug(head['label'])
            if name in names:
                raise SystemExit(f'duplicate neighbour slug {name}')
            names.append(name)
            keep_neighbours.add(name)
            (neighbours_dir / f'{name}.json').write_text(_head_bytes(head))
        neighbour_index = {'k': neighbours['k'], 'background': 'background', 'heads': names}
    if neighbours_dir.exists():
        for stale in neighbours_dir.glob('*.json'):
            if stale.stem not in keep_neighbours:
                stale.unlink()
    entries = [(name, heads_dir / f'{name}.json') for name in used]
    entries += [(f'neighbour/{name}', neighbours_dir / f'{name}.json') for name in keep_neighbours]
    lines = [f'{name} {hashlib.sha256(file.read_bytes()).hexdigest()}' for name, file in sorted(entries)]
    integrity = ('\n'.join(lines) + '\n') if lines else ''
    (root / 'head-sha256.txt').write_text(integrity)
    path.write_text(_format_index(model, slugs, neighbour_index))
    return hashlib.sha256(integrity.encode()).hexdigest()


def drop_learned_pin(path='public/sound-model/manifest.json'):
    """Remove the shared learned.json manifest line. No-op when it is already absent."""
    file = Path(path)
    if not file.exists():
        return False
    manifest = json.loads(file.read_text())
    hashes = manifest.get('sha256') or {}
    if 'learned.json' not in hashes:
        return False
    del hashes['learned.json']
    manifest['sha256'] = hashes
    file.write_text(json.dumps(manifest, indent=2) + '\n')
    return True


def main(argv):
    if len(argv) < 2 or argv[1] not in ('write', 'split'):
        raise SystemExit(__doc__.strip())
    if argv[1] == 'write':
        if len(argv) < 3:
            raise SystemExit('usage: learned_store.py write <model.json> [dest learned.json]')
        dest = argv[3] if len(argv) > 3 else 'public/sound-model/learned.json'
        print(write_learned(dest, load_learned(argv[2])))
        return
    path = argv[2] if len(argv) > 2 else 'public/sound-model/learned.json'
    model = load_learned(path)
    digest = write_learned(path, model)
    drop_learned_pin(str(Path(path).parent / 'manifest.json'))
    print(f'{len(model.get("heads") or [])} heads, integrity {digest}')


if __name__ == '__main__':
    main(sys.argv)
