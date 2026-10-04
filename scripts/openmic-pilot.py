#!/usr/bin/env python3
"""Freeze a small, rights-filtered OpenMIC-2018 evaluation pilot.

This utility deliberately performs no model inference, training, downloading, or
prediction scoring.  It accepts only the official OpenMIC archive after its pinned
MD5 has been verified, then safely extracts the selected OGG excerpts and writes a
manifest compatible with src/audio/evaluation.ts.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
from urllib.parse import urlparse
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable


OFFICIAL_ARCHIVE_MD5 = "e4ccf187e2bb5ab2e115416e8aafe7f4"
OFFICIAL_RECORD_URL = "https://zenodo.org/records/1432913"
SELECTION_VERSION = 1
DEFAULT_SEED = "openmic-2018-pilot-v1"
BAD_FMA_RECORDING_IDS = {
    "071826", "071827", "087435", "095253", "095259", "095263", "102144",
    "113025", "113604", "138485",
}
MAX_METADATA_BYTES = 100 * 1024 * 1024
MAX_AUDIO_BYTES_PER_ITEM = 50 * 1024 * 1024
MAX_EXTRACTED_AUDIO_BYTES = 500 * 1024 * 1024
RUNTIME_LABEL_MAPPING = {'accordion': ['accordion'], 'banjo': ['banjo'], 'cello': ['cello'], 'clarinet': ['clarinet'], 'flute': ['flute'], 'mandolin': ['mandolin'], 'saxophone': ['saxophone'], 'synthesizer': ['synthesizer'], 'trombone': ['trombone'], 'trumpet': ['trumpet'], 'ukulele': ['ukulele'], 'voice': ['voice'], 'bass': ['bass guitar', 'double bass'], 'cymbals': ['cymbal', 'hi-hat'], 'drums': ['drum', 'drum kit', 'drum machine', 'snare drum', 'bass drum', 'timpani', 'tom-tom'], 'mallet_percussion': ['mallet percussion', 'marimba / xylophone', 'vibraphone', 'glockenspiel'], 'violin': ['violin / fiddle'], 'guitar': ['guitar', 'electric guitar', 'acoustic guitar', 'steel guitar / slide guitar'], 'piano': ['piano', 'electric piano'], 'organ': ['organ', 'electronic organ', 'hammond organ']}
PILOT_COUNTS = {"train": 12, "calibration": 12, "test": 24}


class PilotError(RuntimeError):
    pass


@dataclass(frozen=True)
class Candidate:
    sample_key: str
    track_id: str
    album_id: str
    album_title: str
    album_url: str
    artist_id: str
    artist_name: str
    artist_url: str
    track_title: str
    track_url: str
    license_title: str
    license_url: str
    partition: str


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def archive_md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_frozen_at(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise PilotError("--frozen-at must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise PilotError("--frozen-at must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_member_name(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if not name or "\\" in name or path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise PilotError(f"unsafe archive member name: {name!r}")
    return path


def validate_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    for member in members:
        safe_member_name(member.name)
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise PilotError(f"unsafe archive member type: {member.name!r}")
        if not (member.isdir() or member.isreg()):
            raise PilotError(f"unsupported archive member type: {member.name!r}")
    return members


def member_for_suffix(members: Iterable[tarfile.TarInfo], suffix: str) -> tarfile.TarInfo:
    found = [member for member in members if member.isfile() and
             (member.name == suffix or member.name.endswith("/" + suffix))]
    if len(found) != 1:
        raise PilotError(f"expected exactly one archive member ending in {suffix!r}, found {len(found)}")
    return found[0]


def read_member(archive: tarfile.TarFile, member: tarfile.TarInfo, limit: int = MAX_METADATA_BYTES) -> bytes:
    if member.size > limit:
        raise PilotError(f"archive member exceeds limit: {member.name!r}")
    stream = archive.extractfile(member)
    if stream is None:
        raise PilotError(f"cannot read archive member: {member.name!r}")
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise PilotError(f"archive member exceeds limit while reading: {member.name!r}")
    return data


def read_csv(data: bytes, name: str) -> list[dict[str, str]]:
    try:
        return list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
    except (UnicodeDecodeError, csv.Error) as error:
        raise PilotError(f"cannot parse {name}") from error


def partition_keys(data: bytes, name: str) -> set[str]:
    try:
        lines = data.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError as error:
        raise PilotError(f"cannot parse {name}") from error
    return {line.strip().split()[0] for line in lines if line.strip() and not line.lstrip().startswith("#")}


def allowed_license(url: str) -> bool:
    parsed = urlparse(url.lower())
    return parsed.scheme in ("http", "https") and parsed.hostname == "creativecommons.org" and (
        parsed.path.startswith("/licenses/by/") or parsed.path.startswith("/publicdomain/zero/"))


def bad_recording_id(track_id: str) -> bool:
    numeric = track_id.strip().zfill(6)
    return track_id.strip() in BAD_FMA_RECORDING_IDS or numeric in BAD_FMA_RECORDING_IDS


def stable_key(seed: str, *parts: str) -> str:
    return hashlib.sha256("\0".join((seed, *parts)).encode("utf-8")).hexdigest()


def observed_annotations(rows: list[dict[str, str]], classes: set[str]) -> dict[str, list[dict[str, Any]]]:
    # Official CSV repeats some pairs. Last row reproduces canonical NPZ Y_true/Y_mask.
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        sample_key = row.get("sample_key", "").strip()
        instrument = row.get("instrument", "").strip()
        try:
            relevance = float(row.get("relevance", ""))
        except ValueError as error:
            raise PilotError(f"invalid relevance for {sample_key!r}") from error
        if not math.isfinite(relevance) or not 0 <= relevance <= 1:
            raise PilotError(f"invalid relevance for {sample_key!r}")
        if sample_key and instrument in classes:
            pairs[(sample_key, instrument)] = {"instrument": instrument, "relevance": relevance,
                "state": "present" if relevance >= 0.5 else "absent", "numResponses": row.get("num_responses", "")}
    out: dict[str, list[dict[str, Any]]] = {}
    for (sample_key, _), annotation in pairs.items():
        out.setdefault(sample_key, []).append(annotation)
    return {key: sorted(value, key=lambda item: item["instrument"]) for key, value in out.items()}


def candidates_from_metadata(rows: list[dict[str, str]], train: set[str], test: set[str]) -> list[Candidate]:
    overlap = train & test
    if overlap:
        raise PilotError(f"official train/test partitions overlap ({len(overlap)} sample keys)")
    candidates: list[Candidate] = []
    seen: set[str] = set()
    for row in rows:
        sample_key = row.get("sample_key", "").strip()
        if not sample_key or sample_key in seen:
            continue
        partition = "train" if sample_key in train else "test" if sample_key in test else ""
        if not partition:
            continue
        track_id = row.get("track_id", "").strip()
        artist_id = row.get("artist_id", "").strip()
        album_id = row.get("album_id", "").strip()
        license_url = row.get("license_url", "").strip()
        if not track_id or not artist_id or not album_id or not allowed_license(license_url) or bad_recording_id(track_id):
            continue
        seen.add(sample_key)
        candidates.append(Candidate(
            sample_key=sample_key, track_id=track_id, album_id=album_id,
            album_title=row.get("album_title", "").strip(), album_url=row.get("album_url", "").strip(),
            artist_id=artist_id, artist_name=row.get("artist_name", "").strip(), artist_url=row.get("artist_url", "").strip(),
            track_title=row.get("track_title", "").strip(), track_url=row.get("track_url", "").strip(),
            license_title=row.get("license_title", "").strip(), license_url=license_url, partition=partition,
        ))
    return candidates


def choose_pilot(candidates: list[Candidate], seed: str) -> dict[str, list[Candidate]]:
    """Select one recording per artist in hash order, with cross-split provenance guards."""
    by_partition_artist: dict[str, dict[str, list[Candidate]]] = {"train": {}, "test": {}}
    for candidate in candidates:
        by_partition_artist[candidate.partition].setdefault(candidate.artist_id, []).append(candidate)
    for groups in by_partition_artist.values():
        for values in groups.values():
            values.sort(key=lambda item: stable_key(seed, "recording", item.sample_key))

    selected: dict[str, list[Candidate]] = {"train": [], "calibration": [], "test": []}
    used_artists: set[str] = set()
    used_albums: set[str] = set()
    used_tracks: set[str] = set()
    # Selection itself depends only on identity/provenance and a documented seed, never labels or predictions.
    for target, partition in (("train", "train"), ("calibration", "train"), ("test", "test")):
        artists = sorted(by_partition_artist[partition], key=lambda artist: stable_key(seed, "artist", target, artist))
        for artist in artists:
            if len(selected[target]) == PILOT_COUNTS[target]:
                break
            if artist in used_artists:
                continue
            for candidate in by_partition_artist[partition][artist]:
                if candidate.album_id in used_albums or candidate.track_id in used_tracks:
                    continue
                selected[target].append(candidate)
                used_artists.add(artist)
                used_albums.add(candidate.album_id)
                used_tracks.add(candidate.track_id)
                break
        if len(selected[target]) != PILOT_COUNTS[target]:
            raise PilotError(f"insufficient eligible, provenance-distinct {target} artists: "
                             f"needed {PILOT_COUNTS[target]}, selected {len(selected[target])}")
    return selected


def audio_member(members: Iterable[tarfile.TarInfo], sample_key: str) -> tarfile.TarInfo:
    expected = f"audio/{sample_key[:3]}/{sample_key}.ogg"
    return member_for_suffix(members, expected)


def safe_output_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise PilotError(f"output directory is not a real directory: {path}")


def extract_audio(archive: tarfile.TarFile, members: list[tarfile.TarInfo], selected: list[Candidate], output: Path) -> dict[str, dict[str, Any]]:
    audio_dir = output / "audio"
    safe_output_directory(audio_dir)
    hashes: dict[str, dict[str, Any]] = {}
    extracted = 0
    for candidate, member in sorted(((candidate, audio_member(members, candidate.sample_key)) for candidate in selected), key=lambda pair: pair[1].offset_data):
        if member.size > MAX_AUDIO_BYTES_PER_ITEM:
            raise PilotError(f"selected audio member exceeds per-item limit: {member.name!r}")
        extracted += member.size
        if extracted > MAX_EXTRACTED_AUDIO_BYTES:
            raise PilotError("selected audio exceeds total extraction limit")
        destination = audio_dir / f"{candidate.sample_key}.ogg"
        if destination.exists() or destination.is_symlink():
            raise PilotError(f"refusing to overwrite existing audio: {destination}")
        stream = archive.extractfile(member)
        if stream is None:
            raise PilotError(f"cannot read selected audio: {member.name!r}")
        fd, temporary = tempfile.mkstemp(prefix=f".{candidate.sample_key}.", suffix=".tmp", dir=audio_dir)
        digest = hashlib.sha256()
        size = 0
        try:
            with os.fdopen(fd, "wb") as target:
                while True:
                    block = stream.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    if size > MAX_AUDIO_BYTES_PER_ITEM:
                        raise PilotError(f"selected audio exceeds per-item limit while reading: {member.name!r}")
                    digest.update(block)
                    target.write(block)
            os.replace(temporary, destination)
        except Exception:
            Path(temporary).unlink(missing_ok=True)
            raise
        hashes[candidate.sample_key] = {"archiveMember": member.name, "bytes": size, "sha256": digest.hexdigest(),
                                        "path": f"audio/{candidate.sample_key}.ogg"}
    return hashes


def manifest_item(candidate: Candidate, split: str, frozen_at: str, annotations: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    source_url = candidate.track_url or candidate.album_url or OFFICIAL_RECORD_URL
    rights_basis = f"OpenMIC metadata: {candidate.license_title or 'CC-BY/CC0'} ({candidate.license_url})"
    reviews = [{"reviewer": "OpenMIC-2018 aggregated annotations", "at": frozen_at,
                "dimension": "instrument", "label": annotation["instrument"], "state": annotation["state"]}
               for annotation in annotations.get(candidate.sample_key, [])]
    return {
        "id": candidate.sample_key, "split": split, "tier": "song", "source": source_url,
        "rights": {"evaluationAllowed": True, "basis": rights_basis},
        "groups": {"original": f"openmic:{candidate.sample_key}", "artist": f"fma-artist:{candidate.artist_id}",
                   "pack": f"fma-album:{candidate.album_id}", "sampleFamily": f"fma-track:{candidate.track_id}"},
        "transformations": [], "start": 0, "end": 10,
        "reviews": reviews,
    }


def write_json_new(path: Path, data: Any) -> None:
    if path.exists() or path.is_symlink():
        raise PilotError(f"refusing to overwrite existing file: {path}")
    encoded = json.dumps(data, indent=2, sort_keys=True) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(encoded)
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def build_pilot(archive_path: Path, output: Path, frozen_at: str, seed: str = DEFAULT_SEED,
                expected_md5: str = OFFICIAL_ARCHIVE_MD5) -> dict[str, Any]:
    if not archive_path.is_file():
        raise PilotError(f"archive does not exist: {archive_path}")
    actual_md5 = archive_md5(archive_path)
    if actual_md5 != expected_md5:
        raise PilotError(f"archive MD5 mismatch: expected {expected_md5}, got {actual_md5}; no archive members were read")
    safe_output_directory(output)
    for name in ("openmic-pilot-manifest.json", "openmic-pilot-selection.json"):
        if (output / name).exists() or (output / name).is_symlink():
            raise PilotError(f"refusing to overwrite existing output: {name}")
    with tarfile.open(archive_path, "r:gz") as archive:
        members = validate_members(archive)
        class_map_data = read_member(archive, member_for_suffix(members, "class-map.json"))
        class_map = json.loads(class_map_data)
        if not isinstance(class_map, dict) or not all(isinstance(key, str) for key in class_map):
            raise PilotError("invalid class-map.json")
        metadata_member = member_for_suffix(members, "openmic-2018-metadata.csv")
        labels_member = member_for_suffix(members, "openmic-2018-aggregated-labels.csv")
        train_member = member_for_suffix(members, "partitions/split01_train.csv")
        test_member = member_for_suffix(members, "partitions/split01_test.csv")
        metadata_data = read_member(archive, metadata_member)
        labels_data = read_member(archive, labels_member)
        train_data = read_member(archive, train_member)
        test_data = read_member(archive, test_member)
        train = partition_keys(train_data, train_member.name)
        test = partition_keys(test_data, test_member.name)
        annotations = observed_annotations(read_csv(labels_data, labels_member.name), set(class_map))
        selected = choose_pilot(candidates_from_metadata(read_csv(metadata_data, metadata_member.name), train, test), seed)
        in_order = [candidate for split in ("train", "calibration", "test") for candidate in selected[split]]
        audio_hashes = extract_audio(archive, members, in_order, output)

    items = [manifest_item(candidate, split, frozen_at, annotations)
             for split in ("train", "calibration", "test") for candidate in selected[split]]
    manifest = {"version": 1, "frozenAt": frozen_at, "items": items}
    selection: dict[str, Any] = {
        "version": SELECTION_VERSION, "dataset": "OpenMIC-2018", "officialRecord": OFFICIAL_RECORD_URL,
        "archive": {"path": str(archive_path), "md5": actual_md5}, "frozenAt": frozen_at, "seed": seed,
        "selectionRule": "hash-ranked identity/provenance only; labels and predictions are excluded from selection",
        "rightsRule": "OpenMIC metadata license_url must be CC-BY or CC0", "excludedFmaRecordingIds": sorted(BAD_FMA_RECORDING_IDS),
        "metadata": {"classMapSha256": sha256_bytes(class_map_data),
                     "metadataSha256": sha256_bytes(metadata_data),
                     "aggregatedLabelsSha256": sha256_bytes(labels_data),
                     "train01Sha256": sha256_bytes(train_data),
                     "test01Sha256": sha256_bytes(test_data)},
        "items": [],
        "annotationPolicy": "Official CSV last-row-wins matches canonical NPZ Y_true/Y_mask: observed relevance >= 0.5 is present; observed below 0.5 is absent; only unobserved pairs are unknown.",
    }
    for split in ("train", "calibration", "test"):
        for candidate in selected[split]:
            selection["items"].append({
                "id": candidate.sample_key, "split": split, "officialPartition": candidate.partition,
                "artist": {"id": candidate.artist_id, "name": candidate.artist_name, "url": candidate.artist_url},
                "album": {"id": candidate.album_id, "title": candidate.album_title, "url": candidate.album_url},
                "recording": {"trackId": candidate.track_id, "title": candidate.track_title, "url": candidate.track_url},
                "rights": {"licenseTitle": candidate.license_title, "licenseUrl": candidate.license_url,
                           "evaluationAllowed": True},
                "audio": audio_hashes[candidate.sample_key],
                "observedAnnotations": annotations.get(candidate.sample_key, []),
            })
    selection["runtimeLabelMapping"] = RUNTIME_LABEL_MAPPING
    selection["decisionPolicies"] = {"sourceCandidates": "Recognition source observations, possible or accepted; candidate retrieval, not calibrated acceptance.", "primarySource": "Automatic soundProfile.source label only; uncalibrated top-source diagnostic.", "acceptedSources": "Recognition source observations explicitly marked accepted; no human corrections or filename labels."}
    selection["selectionSha256"] = sha256_bytes(canonical_json(selection))
    write_json_new(output / "openmic-pilot-manifest.json", manifest)
    write_json_new(output / "openmic-pilot-selection.json", selection)
    return {"manifest": manifest, "selection": selection}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="official openmic-2018-v1.0.0.tgz archive")
    parser.add_argument("output", type=Path, help="new, empty-ish output directory for the frozen pilot")
    parser.add_argument("--frozen-at", required=True, help="ISO-8601 freeze time, including timezone")
    parser.add_argument("--seed", default=DEFAULT_SEED, help="documented selection seed (default: %(default)s)")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        frozen_at = valid_frozen_at(args.frozen_at)
        result = build_pilot(args.archive, args.output, frozen_at, args.seed)
    except (PilotError, OSError, tarfile.TarError, json.JSONDecodeError) as error:
        print(f"openmic-pilot: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"manifest": str(args.output / "openmic-pilot-manifest.json"),
                      "selection": str(args.output / "openmic-pilot-selection.json"),
                      "selectionSha256": result["selection"]["selectionSha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
