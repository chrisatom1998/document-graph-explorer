"""Offline tests for the Jamendo archive fetch: no dataset, ffmpeg, or cdn.freesound.org."""
import hashlib
import importlib.util
import io
import random
import tarfile
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import unittest


def load():
    spec = importlib.util.spec_from_file_location('fetch_jamendo', Path(__file__).with_name('fetch-jamendo.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Headers(dict):
    def get(self, key, default=None):
        return super().get(key, default)


def http_error(code, retry_after=None, url='https://cdn.freesound.org/archive.tar'):
    headers = Headers()
    if retry_after is not None: headers['Retry-After'] = retry_after
    return urllib.error.HTTPError(url, code, 'error', headers, None)


class FakeResp:
    def __init__(self, status, body, headers):
        self.status, self.headers, self.body = status, Headers(headers), body
        self.reads, self.closed = 0, False

    def read(self, n=-1):
        self.reads += 1
        if n is None or n < 0: n = len(self.body)
        chunk, self.body = self.body[:n], self.body[n:]
        return chunk

    def close(self):
        self.closed = True


class Script:
    """opener stand-in: each call returns the next response or raises the next exception."""
    def __init__(self, steps):
        self.steps, self.requests = list(steps), []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        step = self.steps.pop(0)
        if isinstance(step, Exception): raise step
        return step


def source(mod, opener, **kw):
    kw.setdefault('sleep', lambda _seconds: None)
    kw.setdefault('rng', random.Random(0))
    kw.setdefault('log', lambda _message: None)
    return mod.RangeSource('https://cdn.freesound.org/archive.tar', opener=opener, **kw)


class _Fixed:
    def __init__(self, value): self.value = value
    def random(self): return self.value


class RetryDelayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_backoff_stays_inside_the_exponential_band_and_actually_jitters(self):
        rng = random.Random(0)
        # attempt 3 -> base min(60, 5 * 8) = 40, equal jitter in [20, 40)
        delays = [self.mod.retry_delay(3, None, rng) for _ in range(40)]
        self.assertTrue(all(20 <= d < 40 for d in delays), delays)
        self.assertGreater(max(delays) - min(delays), 1)
        self.assertGreaterEqual(self.mod.retry_delay(5, None, random.Random(1)), 30)
        self.assertLess(self.mod.retry_delay(5, None, random.Random(1)), 60)

    def test_retry_after_is_a_floor_with_jitter_above_it(self):
        self.assertEqual(self.mod.retry_delay(4, 30, _Fixed(0)), 30)
        high = self.mod.retry_delay(0, 30, _Fixed(0.999))
        self.assertGreater(high, 30)
        self.assertLess(high, 35)
        capped = self.mod.retry_delay(0, 86400, _Fixed(0))
        self.assertEqual(capped, self.mod.RETRY_AFTER_CAP)

    def test_retry_after_seconds_accepts_delta_and_http_date(self):
        now = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
        self.assertEqual(self.mod.retry_after_seconds(http_error(503, '12')), 12)
        dated = http_error(503, 'Fri, 30 Oct 2026 12:00:30 GMT')
        self.assertEqual(self.mod.retry_after_seconds(dated, now=now), 30)
        past = http_error(503, 'Fri, 30 Oct 2026 11:00:00 GMT')
        self.assertEqual(self.mod.retry_after_seconds(past, now=now), 0)
        self.assertIsNone(self.mod.retry_after_seconds(http_error(503, 'soon')))
        self.assertIsNone(self.mod.retry_after_seconds(http_error(503)))
        self.assertIsNone(self.mod.retry_after_seconds(ConnectionError('timed out')))


class RangeSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_budget_stops_a_503_streak_and_each_wait_honors_retry_after(self):
        sleeps = []
        # Retry-After 100s and a 250s budget: the third wait (300s) is past the budget, so two sleeps and three tries.
        opener = Script([http_error(503, '100') for _ in range(6)])
        body = source(self.mod, opener, sleep=sleeps.append, label='folder 73', max_attempts=10, budget=250)
        with self.assertRaises(self.mod.FetchFailed):
            body.read(0, 8)
        self.assertEqual(len(sleeps), 2)
        self.assertTrue(all(s >= 100 for s in sleeps), sleeps)
        self.assertEqual(len(opener.requests), 3)

    def test_attempt_cap_stops_even_when_the_budget_is_large(self):
        sleeps = []
        opener = Script([http_error(503, '1') for _ in range(5)])
        body = source(self.mod, opener, sleep=sleeps.append, max_attempts=3, budget=10_000)
        with self.assertRaises(self.mod.FetchFailed):
            body.read(0, 4)
        self.assertEqual(len(sleeps), 3)
        self.assertEqual(len(opener.requests), 4)

    def test_permanent_client_error_is_not_retried(self):
        sleeps = []
        opener = Script([http_error(404)])
        body = source(self.mod, opener, sleep=sleeps.append, max_attempts=5, budget=10_000)
        with self.assertRaises(self.mod.FetchFailed):
            body.read(0, 4)
        self.assertEqual(sleeps, [])
        self.assertEqual(len(opener.requests), 1)

    def test_a_200_is_not_read_as_the_requested_range(self):
        blob = b'x' * 1000
        whole = FakeResp(200, blob, {'Content-Length': str(len(blob))})
        opener = Script([whole, whole, whole])
        body = source(self.mod, opener, max_attempts=2, budget=10_000)
        with self.assertRaises(self.mod.FetchFailed):
            body.read(0, 16)
        self.assertEqual(whole.reads, 0)
        self.assertEqual(opener.requests[0].get_header('Range'), 'bytes=0-15')

    def test_206_returns_exactly_the_requested_bytes(self):
        payload = b'abcdefghij'
        resp = FakeResp(206, payload, {'Content-Range': 'bytes 0-9/10', 'Content-Length': '10'})
        opener = Script([http_error(503, '7'), resp])
        sleeps = []
        body = source(self.mod, opener, sleep=sleeps.append, max_attempts=5, budget=10_000)
        self.assertEqual(body.read(0, 10), payload)
        self.assertGreaterEqual(sleeps[0], 7)
        self.assertEqual(opener.requests[1].get_header('Range'), 'bytes=0-9')
        # A byte that arrives clears the streak, so one more blip does not carry the old count.
        self.assertEqual(body.failures, 0)

    def test_416_is_the_end_of_the_archive_and_is_not_retried(self):
        opener = Script([http_error(416)])
        body = source(self.mod, opener, max_attempts=5, budget=10_000)
        with self.assertRaises(self.mod.ArchiveEnded):
            body.read(100, 512)
        self.assertEqual(len(opener.requests), 1)


def tar_bytes(members):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tar:
        for name, payload in members:
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return buf.getvalue()


class WalkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_walk_downloads_only_the_pending_member_and_checks_its_hash(self):
        keep = b'kept-track-bytes'
        skip = b'S' * 2000
        blob = tar_bytes([('00/skip.mp3', skip), ('00/keep.mp3', keep)])
        ranges = []

        def read_at(start, length):
            ranges.append((start, length))
            return blob[start:start + length]

        found = {}
        want = {'00/keep.mp3': hashlib.sha256(keep).hexdigest()}
        self.mod.walk_tar(read_at, {'00/keep.mp3': True}, want, lambda rel, data: found.__setitem__(rel, data))
        self.assertEqual(found, {'00/keep.mp3': keep})
        bodies = [length for _start, length in ranges if length != 512]
        self.assertIn(len(keep), bodies)
        self.assertNotIn(len(skip), bodies)

    def test_a_416_ends_the_walk_instead_of_retrying_the_header(self):
        def read_at(_start, _length):
            raise self.mod.ArchiveEnded()
        with self.assertRaises(ValueError):
            self.mod.walk_tar(read_at, {'00/a.mp3': True}, {'00/a.mp3': 'ab'}, lambda *_args: None)

    def test_checksum_mismatch_is_not_stored(self):
        payload = b'hello jamendo'
        blob = tar_bytes([('13/track.mp3', payload)])
        stored = []
        with self.assertRaises(ValueError):
            self.mod.walk_tar(lambda start, length: blob[start:start + length], {'13/track.mp3': True},
                              {'13/track.mp3': '0' * 64}, lambda rel, data: stored.append(data))
        self.assertEqual(stored, [])

    def test_track_verified_requires_the_stamp_of_this_source_hash(self):
        mod = self.mod
        import tempfile
        payload = b'abc'
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as out:
            item = {'id': 'track-1'}
            self.assertFalse(mod.track_verified('00/a.mp3', item, out, {'00/a.mp3': digest}))
            wav = Path(out, 'track-1.wav')
            wav.write_bytes(b'RIFFxxxxWAVE' + b'\0' * 40)
            self.assertFalse(mod.track_verified('00/a.mp3', item, out, {'00/a.mp3': digest}))
            Path(str(wav) + '.sha256').write_text(digest + '\n')
            self.assertTrue(mod.track_verified('00/a.mp3', item, out, {'00/a.mp3': digest}))
            self.assertFalse(mod.track_verified('00/a.mp3', item, out, {'00/a.mp3': 'f' * 64}))


class LocalServerTests(unittest.TestCase):
    """The real urllib stack, against a loopback server, so Range and Retry-After are not only faked."""

    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_urllib_range_after_503_then_tar_walk(self):
        payload = b'jamendo-track'
        blob = tar_bytes([('80/track.low.mp3', payload)])
        state = {'hits': []}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                state['hits'].append(self.headers.get('Range'))
                if len(state['hits']) == 1:
                    self.send_response(503)
                    self.send_header('Retry-After', '0')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                if not self.headers.get('Range'):
                    self.send_response(400)
                    self.end_headers()
                    return
                start_s, end_s = self.headers['Range'].split('=', 1)[1].split('-', 1)
                start, end = int(start_s), int(end_s)
                chunk = blob[start:end + 1]
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{end}/{len(blob)}')
                self.send_header('Content-Length', str(len(chunk)))
                self.end_headers()
                self.wfile.write(chunk)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        found = {}
        try:
            url = f'http://127.0.0.1:{server.server_address[1]}/raw_30s_audio-low-80.tar'
            src = self.mod.RangeSource(url, opener=urllib.request.urlopen, sleep=lambda _s: None,
                                        rng=random.Random(0), log=lambda _m: None, label='folder 80',
                                        max_attempts=5, budget=10_000)
            want = {'80/track.low.mp3': hashlib.sha256(payload).hexdigest()}
            self.mod.walk_tar(src.read, {'80/track.low.mp3': True}, want, lambda rel, data: found.__setitem__(rel, data))
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
        self.assertEqual(found, {'80/track.low.mp3': payload})
        # The 503 was a ranged read, and the retry asked for that same range again.
        self.assertEqual(state['hits'][0], state['hits'][1])
        self.assertTrue(state['hits'][0].startswith('bytes=0-'))


if __name__ == '__main__':
    unittest.main()
