"""Local review page for the human-checked DJ test set. Serves the clips and saves each answer
the moment it is given, so a session can stop and resume at any point.
Usage: dj-test-set-server.py <test set dir> [port]"""
import json, os, sys, time, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
ROOT = sys.argv[1]; PORT = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.environ.get('PORT', 5210))
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dj-test-set', 'index.html')
LABELS = os.path.join(ROOT, 'labels.json')
def read(path, default):
    try: return json.load(open(path))
    except Exception: return default
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, kind='application/json'):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code); self.send_header('Content-Type', kind); self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.path in ('/', '/index.html'): return self.send(200, open(PAGE, 'rb').read(), 'text/html; charset=utf-8')
        if self.path == '/state':
            clips = read(os.path.join(ROOT, 'clips.json'), {'clips': []})['clips']
            # The reviewer never sees file names or the label guessed from them.
            return self.send(200, json.dumps({'clips': [c['id'] for c in clips], 'labels': read(LABELS, {})}))
        m = re.fullmatch(r'/audio/([0-9a-f]{12})\.mp3', self.path)
        if m and os.path.exists(os.path.join(ROOT, 'audio', m.group(1) + '.mp3')):
            return self.send(200, open(os.path.join(ROOT, 'audio', m.group(1) + '.mp3'), 'rb').read(), 'audio/mpeg')
        self.send(404, '{}')
    def do_POST(self):
        if self.path != '/save': return self.send(404, '{}')
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0)) or 0) or b'{}')
        if not re.fullmatch(r'[0-9a-f]{12}', str(body.get('id', ''))): return self.send(400, '{}')
        labels = read(LABELS, {})
        labels[body['id']] = {'family': body.get('family'), 'details': body.get('details', []), 'effects': body.get('effects', []),
                              'at': time.strftime('%Y-%m-%dT%H:%M:%S')}
        tmp = LABELS + '.tmp'; json.dump(labels, open(tmp, 'w'), indent=1); os.replace(tmp, LABELS)   # never a half-written file
        self.send(200, json.dumps({'saved': len(labels)}))
print(f'DJ test set review: http://localhost:{PORT}', flush=True)
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
