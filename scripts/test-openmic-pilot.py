#!/usr/bin/env python3
"""Synthetic tests for OpenMIC pilot checksum, selection, and tar safety guards."""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("openmic-pilot.py")
SPEC = importlib.util.spec_from_file_location("openmic_pilot", MODULE_PATH)
assert SPEC and SPEC.loader
pilot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)


def csv_bytes(rows: list[dict[str, str]], fields: list[str]) -> bytes:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode()


def add_bytes(archive: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))


def make_archive(path: Path, unsafe_link: bool = False) -> str:
    metadata_fields = ["track_id", "album_id", "album_title", "album_url", "artist_id", "artist_name", "artist_url", "license_title", "license_url", "track_title", "track_url", "sample_key"]
    metadata: list[dict[str, str]] = []
    labels: list[dict[str, str]] = []
    train: list[str] = []
    test: list[str] = []
    for number in range(48):
        key = f"{number + 1:06d}_{number:06d}"
        (train if number < 24 else test).append(key)
        metadata.append({"track_id": str(200000 + number), "album_id": str(300000 + number),
                         "album_title": f"Album {number}", "album_url": f"https://example.test/a/{number}",
                         "artist_id": str(400000 + number), "artist_name": f"Artist {number}",
                         "artist_url": f"https://example.test/artist/{number}", "license_title": "Attribution 4.0 International",
                         "license_url": "https://creativecommons.org/licenses/by/4.0/", "track_title": f"Track {number}",
                         "track_url": f"https://example.test/track/{number}", "sample_key": key})
        labels.append({"sample_key": key, "instrument": "piano", "relevance": "0.5", "num_responses": "3"})
    with tarfile.open(path, "w:gz") as archive:
        add_bytes(archive, "class-map.json", json.dumps({"piano": 0}).encode())
        add_bytes(archive, "openmic-2018-metadata.csv", csv_bytes(metadata, metadata_fields))
        add_bytes(archive, "openmic-2018-aggregated-labels.csv", csv_bytes(labels, ["sample_key", "instrument", "relevance", "num_responses"]))
        add_bytes(archive, "partitions/split01_train.csv", ("\n".join(train) + "\n").encode())
        add_bytes(archive, "partitions/split01_test.csv", ("\n".join(test) + "\n").encode())
        for key in train + test:
            add_bytes(archive, f"audio/{key[:3]}/{key}.ogg", f"audio:{key}".encode())
        if unsafe_link:
            link = tarfile.TarInfo("audio/unsafe.ogg")
            link.type = tarfile.SYMTYPE
            link.linkname = "../../outside"
            archive.addfile(link)
    return hashlib.md5(path.read_bytes()).hexdigest()


class OpenMicPilotTests(unittest.TestCase):
    frozen_at = "2026-10-03T00:00:00Z"

    def test_observed_negatives_and_duplicate_rows_match_canonical_policy(self) -> None:
        rows = [{"sample_key":"a","instrument":"piano","relevance":"0.8"},
                {"sample_key":"a","instrument":"piano","relevance":"0.2"},
                {"sample_key":"a","instrument":"guitar","relevance":"0.5"}]
        labels = pilot.observed_annotations(rows, {"piano","guitar","voice"})["a"]
        self.assertEqual([(x["instrument"],x["state"]) for x in labels], [("guitar","present"),("piano","absent")])
        self.assertFalse(pilot.allowed_license("https://evil.test/creativecommons.org/licenses/by/4.0/"))
        self.assertNotIn("bass guitar",pilot.RUNTIME_LABEL_MAPPING["guitar"])

    def test_checksum_failure_reads_nothing_and_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "fixture.tgz"
            make_archive(archive)
            output = root / "output"
            with self.assertRaisesRegex(pilot.PilotError, "MD5 mismatch"):
                pilot.build_pilot(archive, output, self.frozen_at, expected_md5="0" * 32)
            self.assertFalse(output.exists())

    def test_frozen_selection_is_complete_and_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "fixture.tgz"
            checksum = make_archive(archive)
            first = pilot.build_pilot(archive, root / "first", self.frozen_at, expected_md5=checksum)
            second = pilot.build_pilot(archive, root / "second", self.frozen_at, expected_md5=checksum)
            self.assertEqual(first["selection"]["selectionSha256"], second["selection"]["selectionSha256"])
            self.assertEqual([item["split"] for item in first["selection"]["items"]].count("train"), 12)
            self.assertEqual([item["split"] for item in first["selection"]["items"]].count("calibration"), 12)
            self.assertEqual([item["split"] for item in first["selection"]["items"]].count("test"), 24)
            self.assertEqual(len({item["artist"]["id"] for item in first["selection"]["items"]}), 48)
            manifest = json.loads((root / "first" / "openmic-pilot-manifest.json").read_text())
            self.assertEqual(len(manifest["items"]), 48)
            self.assertTrue(all(review["state"] == "present" for item in manifest["items"] for review in item["reviews"]))

    def test_verified_archive_with_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "unsafe.tgz"
            checksum = make_archive(archive, unsafe_link=True)
            with self.assertRaisesRegex(pilot.PilotError, "unsafe archive member type"):
                pilot.build_pilot(archive, root / "output", self.frozen_at, expected_md5=checksum)


if __name__ == "__main__":
    unittest.main()
