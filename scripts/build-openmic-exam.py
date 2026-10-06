#!/usr/bin/env python3
"""Freeze a bigger, artist-separated OpenMIC-2018 song exam (the "song exam", 2026-10-06).

The 2026-10-03 pilot has only 24 locked test clips, so one clip moves recall by about five points.
This exam reuses the pilot's rights filter, annotation policy and identity-only hash ranking
(scripts/openmic-pilot.py), with a new seed and bigger splits:

  * train (development): official-train artists. Ideas may be tuned here.
  * test (locked): official-test artists. Never used to choose a rule, threshold or alias.

Every pilot clip, artist, album and recording is excluded, so the pilot stays a separate check.
No artist is in both splits and no recording is used twice; at most --test-per-artist / --train-per-artist clips per artist
(only ~120 official-test artists have CC BY/CC0 clips). Selection never reads labels or predictions.
Audio is written as 16-bit mono 44.1 kHz WAV (decoded by ffmpeg) under opaque ids so the upload
harness (scripts/stitched-song-eval.mjs) can read it; the original OGG hash is recorded too.

Usage: python3 scripts/build-openmic-exam.py <openmic-2018-v1.0.0.tgz> <out-dir>
Writes <out-dir>/audio/*.wav, <out-dir>/songs.json (harness list) and
docs/evaluations/openmic-exam-2026-10-06/{manifest,selection}.json (refuses to overwrite).
"""
from __future__ import annotations

import argparse, hashlib, importlib.util, json, subprocess, sys, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('openmic_pilot', ROOT / 'scripts' / 'openmic-pilot.py')
pilot = importlib.util.module_from_spec(spec); sys.modules['openmic_pilot'] = pilot; spec.loader.exec_module(pilot)

SEED = 'openmic-2018-exam-v1'
FROZEN_AT = '2026-10-06T04:30:00Z'
OUT_DOCS = ROOT / 'docs' / 'evaluations' / 'openmic-exam-2026-10-06'
PILOT_MANIFEST = ROOT / 'docs' / 'evaluations' / 'openmic-2026-10-03' / 'manifest.json'


def choose(candidates, counts, per_artist, seed, used_artists, used_tracks):
    """Locked test first (so it gets the widest artist pool), then development from artists the test does not use.
    Up to `per_artist` different recordings per artist: only ~120 official-test artists have CC BY/CC0 clips."""
    by = {'train': {}, 'test': {}}
    for c in candidates:
        by[c.partition].setdefault(c.artist_id, []).append(c)
    for groups in by.values():
        for values in groups.values():
            values.sort(key=lambda item: pilot.stable_key(seed, 'recording', item.sample_key))
    selected = {split: [] for split in counts}
    for split in ('test', 'train'):   # split name == official partition it draws from
        taken = set()
        artists = [a for a in sorted(by[split], key=lambda a: pilot.stable_key(seed, 'artist', split, a)) if a not in used_artists]
        for rnd in range(per_artist[split]):   # round-robin: every artist's first clip before anyone's second
            for artist in artists:
                if len(selected[split]) == counts[split]:
                    break
                for c in by[split][artist]:
                    if c.track_id in used_tracks or c.sample_key in taken:
                        continue
                    if sum(1 for x in selected[split] if x.artist_id == artist) > rnd:
                        break
                    selected[split].append(c); taken.add(c.sample_key); used_tracks.add(c.track_id)
                    break
        used_artists |= {c.artist_id for c in selected[split]}
        if len(selected[split]) != counts[split]:
            raise pilot.PilotError(f'only {len(selected[split])} eligible {split} clips, wanted {counts[split]}')
    return selected


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('archive', type=Path); ap.add_argument('out', type=Path)
    # Defaults take every eligible official-test clip up to 10 per artist (58 artists after the pilot's are removed).
    ap.add_argument('--train', type=int, default=200); ap.add_argument('--test', type=int, default=176)
    ap.add_argument('--train-per-artist', type=int, default=4); ap.add_argument('--test-per-artist', type=int, default=10)
    args = ap.parse_args()
    if (OUT_DOCS / 'manifest.json').exists():
        raise pilot.PilotError(f'refusing to overwrite the frozen exam in {OUT_DOCS}')
    md5 = pilot.archive_md5(args.archive)
    if md5 != pilot.OFFICIAL_ARCHIVE_MD5:
        raise pilot.PilotError(f'archive MD5 mismatch: {md5}')
    old = json.loads(PILOT_MANIFEST.read_text())['items']
    used_artists = {i['groups']['artist'].split(':', 1)[1] for i in old}
    used_tracks = {i['groups']['sampleFamily'].split(':', 1)[1] for i in old}
    pilot_ids = {i['id'] for i in old}
    with tarfile.open(args.archive, 'r:gz') as archive:
        members = pilot.validate_members(archive)
        get = lambda suffix: pilot.read_member(archive, pilot.member_for_suffix(members, suffix))
        class_map = json.loads(get('class-map.json'))
        meta, labels = get('openmic-2018-metadata.csv'), get('openmic-2018-aggregated-labels.csv')
        train_data, test_data = get('partitions/split01_train.csv'), get('partitions/split01_test.csv')
        annotations = pilot.observed_annotations(pilot.read_csv(labels, 'labels'), set(class_map))
        candidates = [c for c in pilot.candidates_from_metadata(pilot.read_csv(meta, 'metadata'),
                      pilot.partition_keys(train_data, 'train'), pilot.partition_keys(test_data, 'test'))
                      if c.sample_key not in pilot_ids]
        selected = choose(candidates, {'train': args.train, 'test': args.test}, {'train': args.train_per_artist, 'test': args.test_per_artist}, SEED, used_artists, used_tracks)
        audio_dir = args.out / 'audio'; audio_dir.mkdir(parents=True, exist_ok=True)
        hashes = {}
        wanted = {c.sample_key for split in selected.values() for c in split}
        for m in members:   # one pass in archive order: random access into the gzip is very slow
            key = Path(m.name).stem
            if not m.isfile() or not m.name.endswith('.ogg') or key not in wanted:
                continue
            ogg = pilot.read_member(archive, m, pilot.MAX_AUDIO_BYTES_PER_ITEM)
            wav = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'],
                                 input=ogg, capture_output=True, check=True).stdout
            (audio_dir / f'{key}.wav').write_bytes(wav)
            hashes[key] = {'archiveMember': m.name, 'oggSha256': hashlib.sha256(ogg).hexdigest(),
                           'wavSha256': hashlib.sha256(wav).hexdigest(), 'path': f'audio/{key}.wav'}
        missing = wanted - set(hashes)
        if missing:
            raise pilot.PilotError(f'{len(missing)} selected clips missing from the archive')
    items = [pilot.manifest_item(c, split, FROZEN_AT, annotations) for split in ('train', 'test') for c in selected[split]]
    manifest = {'version': 1, 'frozenAt': FROZEN_AT, 'items': items}
    selection = {
        'version': 1, 'dataset': 'OpenMIC-2018', 'officialRecord': pilot.OFFICIAL_RECORD_URL, 'archiveMd5': md5,
        'frozenAt': FROZEN_AT, 'seed': SEED,
        'perArtistCap': {'train': args.train_per_artist, 'test': args.test_per_artist},
        'selectionRule': 'hash-ranked identity/provenance only; test chosen first; at most N recordings per artist (round-robin), no recording twice, no artist in both splits; labels and predictions are excluded from selection',
        'exclusions': 'every clip, artist, album and recording of the 2026-10-03 pilot (docs/evaluations/openmic-2026-10-03/manifest.json)',
        'splits': {'train': 'development: official-train artists; ideas may be tuned here',
                   'test': 'locked: official-test artists; never used to choose a rule, threshold or alias'},
        'rightsRule': 'OpenMIC metadata license_url must be CC-BY or CC0',
        'annotationPolicy': 'Official CSV last-row-wins: observed relevance >= 0.5 is present; below 0.5 is absent; unobserved pairs are unknown.',
        'runtimeLabelMapping': pilot.RUNTIME_LABEL_MAPPING,
        'items': [{'id': c.sample_key, 'split': split, 'artist': c.artist_id, 'album': c.album_id, 'track': c.track_id,
                   'license': c.license_url, 'audio': hashes[c.sample_key]} for split in ('train', 'test') for c in selected[split]],
    }
    selection['selectionSha256'] = hashlib.sha256(pilot.canonical_json(selection)).hexdigest()
    OUT_DOCS.mkdir(parents=True, exist_ok=True)
    pilot.write_json_new(OUT_DOCS / 'manifest.json', manifest)
    pilot.write_json_new(OUT_DOCS / 'selection.json', selection)
    (args.out / 'songs.json').write_text(json.dumps({'songs': [{'id': i['id'], 'split': i['split']} for i in items]}))
    observed = lambda s: sum(len(i['reviews']) for i in items if i['split'] == s)
    print(f"froze {len(selected['train'])} train + {len(selected['test'])} test clips; observed labels train {observed('train')}, test {observed('test')}")


if __name__ == '__main__':
    main()
