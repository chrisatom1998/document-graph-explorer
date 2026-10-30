"""Fetch the audio for the frozen MTG-Jamendo held-out tracks in some of the dataset's 100 archive folders.

Usage: python3 scripts/holdout-r3/fetch-jamendo.py <manifest.json> <raw_30s_audio-low_sha256_tracks.txt> <shard i/n> <audio-out-dir>

Folder f (00-99, the last two digits of the track id) belongs to shard i when f % n == i. Each needed folder's
raw_30s/audio-low tar is streamed from the dataset's MTG mirror without being stored; only selected tracks are kept,
each checked against the dataset's published per-track SHA-256, then cut to the manifest's excerpt as 44.1 kHz WAV.

cdn.freesound.org answers HTTP 503 when several shards stream those archives at once. Each folder is read through a
stream that retries 10 times with jittered backoff, waits at least the server's Retry-After, and continues a dropped
body with an HTTP Range request so a blip does not throw away the bytes already read.
"""
import datetime, email.utils, hashlib, http.client, json, os, random, subprocess, sys, tarfile, time, urllib.error, urllib.request

URL = 'https://cdn.freesound.org/mtg-jamendo/raw_30s/audio-low/raw_30s_audio-low-{:02d}.tar'
# Extra attempts after the first failure of a streak. A byte that arrives clears the streak.
RETRIES = 10
# Stops a body that delivers one byte and then dies from retrying for the whole job.
MAX_RECONNECTS = 40
# 4xx that will not start working if we ask again. 408/429 are temporary and are not in this set.
PERMANENT_HTTP = frozenset({400, 401, 403, 404, 410})
BACKOFF_BASE = 5.0
BACKOFF_CAP = 60.0
RETRY_AFTER_CAP = 120.0


class FetchFailed(Exception):
    """The archive could not be streamed after the retry budget was spent."""


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


def _header_int(headers, name):
    raw = headers.get(name) if headers else None
    if raw is None: return None
    raw = str(raw).strip()
    return int(raw) if raw.isdigit() else None


def _close_quietly(obj):
    close = getattr(obj, 'close', None)
    if close is None: return
    try: close()
    except Exception: pass


class ResumableBody:
    """File-like HTTP body. A dropped read continues at the next byte with Range."""

    def __init__(self, url, opener=urllib.request.urlopen, timeout=120, sleep=time.sleep, rng=None, log=print, label='fetch'):
        self.url, self.opener, self.timeout = url, opener, timeout
        self.sleep, self.rng, self.log, self.label = sleep, rng or random.Random(), log, label
        self.pos, self.length, self.failures, self.reconnects = 0, None, 0, 0
        self._resp, self._eof = None, False

    def __enter__(self): return self
    def __exit__(self, *exc): self.close()
    def close(self): self._drop()

    def _drop(self):
        resp, self._resp = self._resp, None
        _close_quietly(resp)

    def _retry(self, err, progress):
        code = getattr(err, 'code', None)
        if code in PERMANENT_HTTP:
            raise FetchFailed(f'{self.label} could not be fetched: {err}') from err
        self.reconnects += 1
        if progress: self.failures = 0
        self.failures += 1
        if self.failures > RETRIES or self.reconnects > MAX_RECONNECTS:
            raise FetchFailed(f'{self.label} could not be fetched: {err}') from err
        delay = retry_delay(self.failures - 1, retry_after_seconds(err), self.rng)
        where = f' at byte {self.pos}' if self.pos else ''
        self.log(f'{self.label} attempt {self.failures}{where}: {err}; waiting {delay:.1f}s')
        self.sleep(delay)

    def _open(self):
        while not self._eof:
            req = urllib.request.Request(self.url)
            if self.pos: req.add_header('Range', f'bytes={self.pos}-')
            try:
                resp = self.opener(req, timeout=self.timeout)
            except Exception as e:
                _close_quietly(e)
                if getattr(e, 'code', None) == 416 and self.pos and (self.length is None or self.pos >= self.length):
                    self._eof = True
                    return
                self._retry(e, progress=False)
                continue
            status = getattr(resp, 'status', 200)
            headers = getattr(resp, 'headers', {}) or {}
            start, total = _content_range(headers)
            if self.pos and status != 206:
                _close_quietly(resp)
                self._retry(OSError(f'HTTP {status} ignored Range at byte {self.pos}'), progress=False)
                continue
            if self.pos and start not in (None, self.pos):
                _close_quietly(resp)
                self._retry(OSError(f'Content-Range started at {start}, wanted {self.pos}'), progress=False)
                continue
            if total is not None and self.length not in (None, total):
                _close_quietly(resp)
                self._retry(OSError(f'length changed from {self.length} to {total}'), progress=False)
                continue
            if total is not None:
                self.length = total
            else:
                size = _header_int(headers, 'Content-Length')
                if size is not None:
                    self.length = size if not self.pos else self.pos + size
                elif self.pos:
                    _close_quietly(resp)
                    self._retry(OSError(f'ranged response at byte {self.pos} had no length'), progress=False)
                    continue
            self._resp = resp
            return

    def read(self, size=-1):
        if self._eof or size == 0: return b''
        want_all = size is None or size < 0
        buf = bytearray()
        while want_all or len(buf) < size:
            if self._resp is None and not self._eof: self._open()
            if self._eof or self._resp is None: break
            need = 256 * 1024 if want_all else size - len(buf)
            try:
                data = self._resp.read(need)
            except http.client.IncompleteRead as e:
                data = e.partial or b''
                self._drop()
                if data:
                    buf.extend(data); self.pos += len(data); self.failures = 0
                if self.length is not None and self.pos >= self.length:
                    self._eof = True
                    break
                if not want_all and len(buf) >= size: break
                self._retry(e, progress=bool(data))
                continue
            except Exception as e:
                self._drop()
                self._retry(e, progress=False)
                continue
            if not data:
                if self.length is not None and self.pos < self.length:
                    self._drop()
                    self._retry(EOFError(f'short read at byte {self.pos} of {self.length}'), progress=False)
                    continue
                self._eof = True
                break
            buf.extend(data); self.pos += len(data); self.failures = 0
        return bytes(buf)


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
        label = f'folder {f:02d}'
        for attempt in range(3):
            got = {}
            try:
                with ResumableBody(URL.format(f), label=label) as body, tarfile.open(fileobj=body, mode='r|') as tar:
                    for m in tar:
                        rel = '/'.join(m.name.split('/')[-2:])
                        if m.isfile() and rel in needed:
                            data = tar.extractfile(m).read()
                            if hashlib.sha256(data).hexdigest() != want[rel]: raise ValueError(f'checksum mismatch for {rel}')
                            got[rel] = data
                            if len(got) == len(needed): break          # stop streaming once every needed track is in hand
                if len(got) == len(needed): break
                raise ValueError(f'{label}: {len(needed) - len(got)} tracks not in the archive')
            except FetchFailed as e:
                print(e, flush=True); sys.exit(f'{label} could not be fetched')
            except Exception as e:
                print(f'{label} pass {attempt + 1}: {e}', flush=True)
                if attempt == 2: sys.exit(f'{label} could not be fetched')
                time.sleep(retry_delay(attempt, None, random.Random()))
        for rel, data in got.items():
            it = needed[rel]; tmp = os.path.join(out, it['id'] + '.mp3')
            open(tmp, 'wb').write(data)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(it['start']), '-t', str(round(it['end'] - it['start'], 3)), '-i', tmp,
                            '-ar', '44100', os.path.join(out, it['id'] + '.wav')], check=True)
            os.remove(tmp); done += 1
        print(f'{label}: {len(got)} tracks', flush=True)
    print(f'shard {shard}: {done} tracks from {len(folders)} folders')


if __name__ == '__main__':
    main(sys.argv[1:5])
