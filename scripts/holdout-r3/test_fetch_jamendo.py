"""Offline tests for the Jamendo archive stream: no dataset, ffmpeg, or cdn.freesound.org."""
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
    def __init__(self, status, body, headers, reads_before_error=None, error=None):
        self.status, self.headers, self.body = status, Headers(headers), body
        self.reads_before_error = reads_before_error
        self.error = error or ConnectionError('connection dropped')
        self.pos, self.reads, self.closed = 0, 0, False

    def read(self, n=-1):
        self.reads += 1
        if self.reads_before_error is not None and self.reads > self.reads_before_error:
            raise self.error
        if n is None or n < 0: n = len(self.body) - self.pos
        chunk = self.body[self.pos:self.pos + n]
        self.pos += len(chunk)
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


def stream(mod, opener, **kw):
    kw.setdefault('sleep', lambda _seconds: None)
    kw.setdefault('rng', random.Random(0))
    kw.setdefault('log', lambda _message: None)
    return mod.ResumableBody('https://cdn.freesound.org/archive.tar', opener=opener, **kw)


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
        # A multi-hour header cannot pin a shard; the cap is still honored as the floor.
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


class _Fixed:
    def __init__(self, value): self.value = value
    def random(self): return self.value


class ResumeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_ten_retries_then_stop_and_each_wait_honors_retry_after(self):
        sleeps = []
        opener = Script([http_error(503, '7') for _ in range(self.mod.RETRIES + 1)])
        body = stream(self.mod, opener, sleep=sleeps.append, label='folder 73')
        with self.assertRaises(self.mod.FetchFailed):
            body.read(1)
        self.assertEqual(len(sleeps), self.mod.RETRIES)
        self.assertTrue(all(s >= 7 for s in sleeps), sleeps)
        self.assertEqual(len(opener.requests), self.mod.RETRIES + 1)

    def test_permanent_client_error_is_not_retried(self):
        sleeps = []
        opener = Script([http_error(404)])
        body = stream(self.mod, opener, sleep=sleeps.append)
        with self.assertRaises(self.mod.FetchFailed):
            body.read(1)
        self.assertEqual(sleeps, [])
        self.assertEqual(len(opener.requests), 1)

    def test_read_resumes_with_range_after_a_short_body(self):
        blob = b'abcdefghij' * 50
        cut = 100
        first = FakeResp(200, blob[:cut], {'Content-Length': str(len(blob))})
        rest = blob[cut:]
        second = FakeResp(206, rest, {
            'Content-Range': f'bytes {cut}-{len(blob) - 1}/{len(blob)}',
            'Content-Length': str(len(rest)),
        })
        opener = Script([first, second])
        body = stream(self.mod, opener, label='folder 13')
        self.assertEqual(body.read(len(blob)), blob)
        self.assertEqual(opener.requests[1].get_header('Range'), f'bytes={cut}-')
        self.assertIsNone(opener.requests[0].get_header('Range'))

    def test_tarfile_extracts_a_member_split_across_the_resume(self):
        payload = b'hello jamendo track'
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w') as tar:
            info = tarfile.TarInfo('13/track.mp3')
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
        blob = buf.getvalue()
        cut = 80  # inside the 512-byte tar header, so one read has to span the resume
        self.assertGreater(len(blob), 512)
        first = FakeResp(200, blob[:cut], {'Content-Length': str(len(blob))})
        rest = blob[cut:]
        second = FakeResp(206, rest, {
            'Content-Range': f'bytes {cut}-{len(blob) - 1}/{len(blob)}',
            'Content-Length': str(len(rest)),
        })
        opener = Script([first, second])
        body = stream(self.mod, opener)
        with tarfile.open(fileobj=body, mode='r|') as tar:
            member = tar.next()
            self.assertEqual(tar.extractfile(member).read(), payload)
        self.assertEqual(opener.requests[1].get_header('Range'), f'bytes={cut}-')

    def test_ignored_range_is_not_appended_onto_the_bytes_already_read(self):
        blob = b'0123456789abcdef' * 8
        cut = 16
        first = FakeResp(200, blob[:cut], {'Content-Length': str(len(blob))})
        # A 200 here is the whole archive again. Accepting it would corrupt the tar stream.
        ignored = FakeResp(200, blob, {'Content-Length': str(len(blob))})
        opener = Script([first] + [ignored] * (self.mod.RETRIES + 1))
        body = stream(self.mod, opener)
        with self.assertRaises(self.mod.FetchFailed):
            body.read(len(blob))
        self.assertEqual(ignored.reads, 0)
        for req in opener.requests[1:]:
            self.assertEqual(req.get_header('Range'), f'bytes={cut}-')

    def test_progress_resets_the_streak_but_reconnects_stay_bounded(self):
        # One byte, then a drop, forever. Consecutive failures never reach 10, the total does.
        def opener(req, timeout=None):
            start = 0
            if req.get_header('Range'): start = int(req.get_header('Range').split('=', 1)[1].rstrip('-'))
            return FakeResp(206 if start else 200, b'X', {
                'Content-Range': f'bytes {start}-{start}/100000',
                'Content-Length': '1',
            }, reads_before_error=1)
        body = stream(self.mod, opener)
        with self.assertRaises(self.mod.FetchFailed):
            body.read(1000)
        self.assertLessEqual(body.reconnects, self.mod.MAX_RECONNECTS + 1)
        self.assertGreater(body.pos, 1)


class LocalServerTests(unittest.TestCase):
    """The real urllib stack, against a loopback server, so Range and Retry-After are not only faked."""

    @classmethod
    def setUpClass(cls):
        cls.mod = load()

    def test_urllib_resume_after_503_and_a_closed_body(self):
        payload = b'jamendo-bytes-' * 1000
        state = {'hits': []}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                state['hits'].append(self.headers.get('Range'))
                n = len(state['hits'])
                if n == 1:
                    self.send_response(503)
                    self.send_header('Retry-After', '1')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                if n == 2:
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(payload)))
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    self.wfile.write(payload[:8])
                    self.close_connection = True
                    return
                start = 0
                if self.headers.get('Range'):
                    start = int(self.headers['Range'].split('=', 1)[1].split('-', 1)[0])
                chunk = payload[start:]
                self.send_response(206)
                self.send_header('Content-Range', f'bytes {start}-{len(payload) - 1}/{len(payload)}')
                self.send_header('Content-Length', str(len(chunk)))
                self.end_headers()
                self.wfile.write(chunk)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        sleeps = []
        try:
            url = f'http://127.0.0.1:{server.server_address[1]}/raw_30s_audio-low-13.tar'
            body = self.mod.ResumableBody(url, opener=urllib.request.urlopen, sleep=sleeps.append,
                                           rng=random.Random(0), log=lambda _m: None, label='folder 13')
            self.assertEqual(body.read(), payload)
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()
        self.assertGreaterEqual(sleeps[0], 1)  # the 503's Retry-After is a floor
        self.assertEqual(state['hits'][0], None)
        self.assertEqual(state['hits'][2], 'bytes=8-')


if __name__ == '__main__':
    unittest.main()
