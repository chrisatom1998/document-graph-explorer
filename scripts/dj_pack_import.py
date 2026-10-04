"""Bounded, local pack staging. Archives are read into flat, content-addressed files."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import threading
import urllib.request
from urllib.parse import urlparse

MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 500 * 1024 * 1024
MAX_SOUNDS = 300
AUDIO = {'.wav', '.mp3', '.ogg', '.flac', '.aiff', '.m4a'}
PACKS = {
    'freepats-synth': {
        'name': 'Synthesizer Percussion',
        'sourceUrl': 'https://freepats.zenvoid.org/Percussion/electric-percussion.html',
        'licenseUrl': 'https://freepats.zenvoid.org/Percussion/electric-percussion.html',
        'license': 'CC0-1.0',
        'downloadUrl': 'https://freepats.zenvoid.org/Percussion/SynthesizerPercussion/SynthesizerPercussion-SFZ-20220718.7z',
    },
    'freepats-world': {
        'name': 'World and Rare Percussion',
        'sourceUrl': 'https://freepats.zenvoid.org/Percussion/world-and-rare-percussion.html',
        'licenseUrl': 'https://freepats.zenvoid.org/Percussion/world-and-rare-percussion.html',
        'license': 'CC0-1.0',
        'downloadUrl': 'https://github.com/freepats/world-percussion/releases/download/2020-09-05/WorldPercussion-SFZ%2BWAV-20200905.7z',
    },
}


def metadata(value):
    if not isinstance(value, dict):
        raise ValueError('Add the pack name and source information.')
    result = {}
    for key in ('name', 'sourceUrl', 'licenseUrl'):
        v = value.get(key, '')
        if not isinstance(v, str) or len(v) > (200 if key == 'name' else 2000):
            raise ValueError('Invalid pack source information.')
        result[key] = v.strip()
    if not result['name']:
        raise ValueError('Enter a pack name.')
    for key in ('sourceUrl', 'licenseUrl'):
        parsed = urlparse(result[key])
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Enter HTTPS publisher and license-page links.')
    result['license'] = 'Needs review; user-supplied source links'
    return result


class PackRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        if parsed.scheme != 'https' or parsed.hostname not in {
            'github.com', 'release-assets.githubusercontent.com',
            'objects.githubusercontent.com', 'freepats.zenvoid.org',
        } or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError('The publisher redirected to an unsupported download host. Download the pack yourself and import its archive.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_pack(pack_id, target):
    if pack_id not in PACKS:
        raise ValueError('This pack needs a manual download. Import its archive below.')
    info = dict(PACKS[pack_id])
    opener = urllib.request.build_opener(PackRedirect())
    with opener.open(info['downloadUrl'], timeout=30) as response, target.open('wb') as out:
        total = 0
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_ARCHIVE:
                raise ValueError('Pack exceeds the 100 MB download limit.')
            out.write(chunk)
    return info


def tar_read(archive, member=None, limit=MAX_ARCHIVE):
    # Never extract archive paths to disk, including links. Read named entries only.
    command = ['tar', '-tf', str(archive)] if member is None else ['tar', '-xOf', str(archive), '--', member]
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
        timer = threading.Timer(30, proc.kill)
        timer.start()
        try:
            result = proc.stdout.read(limit + 1)
            if len(result) > limit:
                proc.kill()
                raise ValueError('Archive content exceeds the size limit.')
            if proc.wait() != 0:
                raise ValueError('Cannot read this archive. Use a ZIP, 7z, or tar archive supported by the local tar program.')
            return result
        finally:
            timer.cancel()


def stage_archive(archive, data_dir, info):
    if archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError('Choose an archive under 100 MB.')
    names = tar_read(archive, limit=1024 * 1024).decode('utf-8', errors='strict').splitlines()
    if len(names) > 2000 or len(set(names)) != len(names):
        raise ValueError('Archive has too many entries or duplicate paths.')
    for name in names:
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or any(ord(c) < 32 for c in name):
            raise ValueError('Archive contains an unsafe path.')
    sounds = [n for n in names if PurePosixPath(n).suffix.lower() in AUDIO and not n.startswith('__MACOSX/')]
    if not sounds:
        raise ValueError('No supported audio found in this archive.')
    if len(sounds) > MAX_SOUNDS:
        raise ValueError('Pack has more than 300 sounds. Import a smaller archive so you can review it in a manageable batch.')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    pack_dir = data_dir / 'packs' / digest
    pack_dir.mkdir(parents=True, exist_ok=True)
    # Preserve the original archive, including license/readme files and directory names.
    stored = pack_dir / 'original.archive'
    if not stored.exists():
        import shutil
        shutil.copyfile(archive, stored)
    provenance = {**info, 'archiveSha256': digest, 'importedAt': datetime.now(timezone.utc).isoformat()}
    (pack_dir / 'source.json').write_text(json.dumps(provenance, indent=2) + '\n')
    uploads = data_dir / 'uploads'
    uploads.mkdir(parents=True, exist_ok=True)
    expanded = 0
    staged = []
    # Stage into temporary files; a rejected archive never reaches the review manifest.
    with tempfile.TemporaryDirectory(dir=pack_dir) as temporary:
        for index, name in enumerate(sounds):
            raw = tar_read(archive, name, min(MAX_ARCHIVE, MAX_EXPANDED - expanded))
            expanded += len(raw)
            sound_id = hashlib.sha256(raw).hexdigest()
            extension = PurePosixPath(name).suffix.lower()
            destination = uploads / (sound_id + extension)
            temp = Path(temporary) / str(index)
            temp.write_bytes(raw)
            staged.append({'id': sound_id, 'title': PurePosixPath(name).name, 'path': destination, 'temp': temp, 'packSource': {**provenance, 'archiveMember': name}})
        for sound in staged:
            if not sound['path'].exists():
                os.replace(sound['temp'], sound['path'])
            del sound['temp']
    return staged
