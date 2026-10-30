"""Fetch the audio for the frozen MTG-Jamendo held-out tracks in some of the dataset's 100 archive folders.

Usage: python3 scripts/holdout-r3/fetch-jamendo.py <manifest.json> <raw_30s_audio-low_sha256_tracks.txt> <shard i/n> <audio-out-dir>

Folder f (00-99, the last two digits of the track id) belongs to shard i when f % n == i. Each needed folder's
raw_30s/audio-low tar is an uncompressed ~1.8 GB archive. Streaming one until the wanted tracks appear takes about
12 minutes and is what cdn.freesound.org answers with HTTP 503 when several shards do it at once. The mirror serves
byte ranges, so this walks the 512-byte member headers and downloads only the selected members.

A 503 or 429 waits out a per-folder budget (jittered backoff, Retry-After as a floor) and then retries that same
range. Tracks already cut to wav, with a stamp of the verified source SHA-256, are left in place, so a later run of
the same shard does not download them again.
"""
import datetime, email.utils, hashlib, json, os, random, subprocess, sys, time, urllib.error, urllib.request

URL = 'https://cdn.freesound.org/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'
# Safety cap on one range. A 30 s low-quality mp3 is far under this; a header that asks for more is not fetched.
MAX_MEMBER = 16_000_000
# Attempts for one range, and seconds of backoff one folder may spend. Whichever runs out first stops the folder.
# ~10 minutes rides out a short CDN blip; a longer outage leaves finished tracks on disk for the next run.
MAX_ATTEMPTS = 20
RETRY_BUDGET = 600.0
# 4xx that will not start working if we ask again. 408/429 are temporary and are not in this set.
PERMANENT_HTTP = frozenset({400, 401, 403, 404, 410})
BACKOFF_BASE = 5.0
BACKOFF_CAP = 60.0
RETRY_AFTER_CAP = 120.0
USER_AGENT = 'dge-accuracy-gate'


class FetchFailed(Exception):
    """A range could not be read after the retry budget was spent."""


class ArchiveEnded(Exception):
    """The server has no bytes at this offset (HTTP 416). The tar walk treats that as end of archive."""


def retry_after_seconds(err, now=None):
    """Seconds the server asked us to wait, or None when the response has no Retry-After.

    Both forms from RFC 9110 are accepted: delta-seconds, and an HTTP-date. A date that is
    already in the past means wait zero seconds, not that the header was missing.
    """
    headers = getattr(err, 'headers', None)
    if not headers: return None
    raw = headers.get('Retry-After')
    if raw is None: return None
    raw = str(raw).strip()
    if not raw: return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        pass
    try:
        when = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if when is None: return None
    if when.tzinfo is None: when = when.replace(tzinfo=datetime.timezone.utc)
    if now is None: now = datetime.datetime.now(datetime.timezone.utc)
    elif now.tzinfo is None: now = now.replace(tzinfo=datetime.timezone.utc)
    return max(0.0, (when - now).total_seconds())


def retry_delay(attempt, retry_after, rng, cap=BACKOFF_CAP, retry_after_cap=RETRY_AFTER_CAP):
    """Seconds to wait before another try. `attempt` is 0 for the first retry.

    Retry-After is a floor: jitter is added above it and never below it, and a huge header is
    capped so one response cannot stall a shard for hours. Without a header the wait is
    exponential (5s, 10s, 20s, ... capped at `cap`) with equal jitter, so parallel shards do
    not retry on the same second.
    """
    if retry_after is not None:
        floor = min(max(0.0, float(retry_after)), retry_after_cap)
        spread = min(5.0, max(0.5, floor * 0.25)) if floor else 0.5
        return floor + rng.random() * spread
    base = min(cap, BACKOFF_BASE * 2 ** attempt)
    return base * (0.5 + rng.random() * 0.5)


def _content_range(headers):
    """(first byte, total length) from a Content-Range header, either of which may be unknown."""
    raw = headers.get('Content-Range') if headers else None
    if not raw: return None, None
    try:
        unit, rest = str(raw).strip().split(None, 1)
        if unit != 'bytes': return None, None
        span, _, total = rest.partition('/')
        start, _, _end = span.partition('-')
        return int(start), (int(total) if total.isdigit() else None)
    except (ValueError, AttributeError):
        return None, None


def _close_quietly(obj):
    close = getattr(obj, 'close', None)
    if close is None: return
    try: close()
    except Exception: pass


class _Status(OSError):
    def __init__(self, code, headers):
        super().__init__(f'HTTP {code}')
        self.code, self.headers = code, headers


class RangeSource:
    """Reads exact byte ranges. A 503/429/dropped connection retries the same range; a 200 is never used."""

    def __init__(self, url, opener=urllib.request.urlopen, timeout=60, sleep=time.sleep, rng=None, log=print,
                 label='fetch', max_attempts=MAX_ATTEMPTS, budget=RETRY_BUDGET):
        self.url, self.opener, self.timeout = url, opener, timeout
        self.sleep, self.rng, self.log, self.label = sleep, rng or random.Random(), log, label
        self.max_attempts, self.budget = max_attempts, budget
        self.failures, self.waited = 0, 0.0

    def _retry(self, err):
        code = getattr(err, 'code', None)
        if code in PERMANENT_HTTP:
            raise FetchFailed(f'{self.label} could not be fetched: {err}') from err
        delay = retry_delay(self.failures, retry_after_seconds(err), self.rng)
        if self.failures + 1 > self.max_attempts or self.waited + delay > self.budget:
            raise FetchFailed(f'{self.label} could not be fetched: {err}') from err
        self.failures += 1
        self.waited += delay
        self.log(f'{self.label}: {err}; waiting {delay:.1f}s (attempt {self.failures}, {self.waited:.0f}s of {self.budget:.0f}s budget)')
        self.sleep(delay)

    def read(self, start, length):
        if length == 0: return b''
        if length < 0 or length > MAX_MEMBER:
            raise FetchFailed(f'{self.label}: refusing a {length}-byte range at {start}')
        while True:
            req = urllib.request.Request(self.url, headers={'Range': f'bytes={start}-{start + length - 1}', 'User-Agent': USER_AGENT})
            resp = None
            try:
                try:
                    resp = self.opener(req, timeout=self.timeout)
                except ArchiveEnded:
                    raise
                except Exception as e:
                    _close_quietly(e)
                    if getattr(e, 'code', None) == 416:
                        raise ArchiveEnded() from e
                    self._retry(e)
                    continue
                status = getattr(resp, 'status', None)
                if status is None: status = getattr(resp, 'code', 200)
                headers = getattr(resp, 'headers', None)
                if status == 416:
                    _close_quietly(resp)
                    raise ArchiveEnded()
                if status != 206:
                    # A 200 is the whole archive. Reading it would pull ~1.8 GB and splice it into a header walk.
                    _close_quietly(resp)
                    self._retry(_Status(status, headers))
                    continue
                got, _total = _content_range(headers)
                if got not in (None, start):
                    _close_quietly(resp)
                    self._retry(_Status(status, headers))
                    continue
                data = resp.read(length + 1)
                _close_quietly(resp)
                resp = None
                if len(data) != length:
                    self._retry(OSError(f'short range at {start}: {len(data)} of {length} bytes'))
                    continue
                self.failures = 0
                return data
            finally:
                if resp is not None: _close_quietly(resp)


def _octal(field):
    raw = field.rstrip(b'\0 ')
    if not raw: return 0
    return int(raw.decode(), 8)


def _header_name(header):
    name = header[:100].split(b'\0', 1)[0].decode('utf-8', 'surrogateescape')
    if header[257:262] == b'ustar':
        prefix = header[345:500].split(b'\0', 1)[0].decode('utf-8', 'surrogateescape')
        if prefix: name = prefix + '/' + name
    return name


def _pax_path(body):
    text = body.decode('utf-8', 'surrogateescape')
    for rec in text.split('\n'):
        if ' path=' in rec: return rec.split(' path=', 1)[1]
    return None


def walk_tar(read_at, pending, want, on_track):
    """Walk an uncompressed tar via read_at(start, length). Calls on_track(rel, mp3_bytes) for each pending member.

    Members that are not pending are skipped: only their 512-byte header is read. `pending` maps archive-relative
    paths (the last two components) to anything truthy. `want` maps those paths to the published SHA-256.
    """
    pos, found, long_name, members = 0, 0, None, 0
    while found < len(pending):
        members += 1
        if members > 100_000: raise ValueError('tar walk did not end')
        try:
            header = read_at(pos, 512)
        except ArchiveEnded:
            break
        if header == b'\0' * 512: break
        size, kind = _octal(header[124:136]), header[156:157]
        name = long_name if long_name is not None else _header_name(header)
        long_name = None
        body = pos + 512
        if kind == b'L':
            long_name = read_at(body, size).rstrip(b'\0').decode('utf-8', 'surrogateescape')
        elif kind in (b'x', b'g'):
            long_name = _pax_path(read_at(body, size))
        elif kind in (b'0', b'\0'):
            rel = '/'.join(name.split('/')[-2:])
            if rel in pending:
                data = read_at(body, size)
                digest = hashlib.sha256(data).hexdigest()
                if digest != want[rel]: raise ValueError(f'checksum mismatch for {rel}')
                on_track(rel, data)
                found += 1
        pos = body + (size + 511) // 512 * 512
    if found < len(pending):
        raise ValueError(f'{len(pending) - found} tracks not in the archive')


def track_verified(rel, item, out, want):
    """True when this track's wav is already on disk and stamped with the published source SHA-256."""
    wav = os.path.join(out, item['id'] + '.wav')
    stamp = wav + '.sha256'
    if not os.path.isfile(wav) or os.path.getsize(wav) < 44: return False
    if not os.path.isfile(stamp): return False
    with open(stamp) as fh: return fh.read().strip() == want.get(rel)


def store_track(rel, data, item, out):
    wav = os.path.join(out, item['id'] + '.wav')
    tmp = wav + '.mp3'
    digest = hashlib.sha256(data).hexdigest()
    try:
        open(tmp, 'wb').write(data)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(item['start']), '-t', str(round(item['end'] - item['start'], 3)),
                        '-i', tmp, '-ar', '44100', wav], check=True)
    except Exception:
        if os.path.exists(wav): os.remove(wav)
        raise
    finally:
        if os.path.exists(tmp): os.remove(tmp)
    open(wav + '.sha256', 'w').write(digest + '\n')


def main(argv):
    manifest, sums, shard, out = argv
    i, n = map(int, shard.split('/'))
    os.makedirs(out, exist_ok=True)
    want = {line.split()[1]: line.split()[0] for line in open(sums)}
    items = {it['archivePath']: it for it in json.load(open(manifest))['items']}
    folders = sorted({int(p.split('/')[0]) for p in items if int(p.split('/')[0]) % n == i})
    done = 0
    for f in folders:
        needed = {p: it for p, it in items.items() if int(p.split('/')[0]) == f}
        pending = {p: it for p, it in needed.items() if not track_verified(p, it, out, want)}
        label = f'folder {f:02d}'
        if not pending:
            print(f'{label}: {len(needed)} tracks already on disk', flush=True)
            done += len(needed)
            continue
        source = RangeSource(URL.format(f), label=label)
        def on_track(rel, data, _needed=needed, _out=out):
            store_track(rel, data, _needed[rel], _out)
        try:
            walk_tar(source.read, pending, want, on_track)
        except FetchFailed as e:
            print(e, flush=True)
            sys.exit(1)
        done += len(needed)
        print(f'{label}: {len(needed)} tracks ({len(pending)} fetched)', flush=True)
    print(f'shard {shard}: {done} tracks from {len(folders)} folders')


if __name__ == '__main__':
    main(sys.argv[1:5])
