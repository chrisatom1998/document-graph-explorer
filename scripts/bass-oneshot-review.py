"""One-clip-at-a-time reviewer for the bass one-shot candidates (see fetch-bass-oneshot-candidates.mjs).
Plays a clip, you press B (bass hit), N (not bass), U (unsure) or Z (undo). Saves to <dir>/reviews.json after every press.
The search hint and clip name are hidden so they cannot bias the label. No model scores are shown. Bass-hinted clips come first.
Usage: python3 scripts/bass-oneshot-review.py <candidate-dir> [port=8768]   (open in Chrome; Safari may not play .ogg)"""
import json, os, sys, random
from http.server import BaseHTTPRequestHandler, HTTPServer

D = os.path.abspath(sys.argv[1]); PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8768
ITEMS = json.load(open(f'{D}/index.json'))['items']
rng = random.Random(20261005)
ORDER = [i['id'] for i in sorted(ITEMS, key=lambda i: (i['hint'] != 'bass', rng.random()))]
RV = f'{D}/reviews.json'
def load(): return json.load(open(RV)) if os.path.exists(RV) else {}

PAGE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Bass clip review</title>
<style>body{font:18px system-ui;max-width:520px;margin:40px auto;padding:0 16px;text-align:center}
button{font:inherit;padding:18px 0;width:30%;border-radius:10px;border:2px solid #888;cursor:pointer}
#b{background:#d8f5d8}#n{background:#f5d8d8}#u{background:#eee}p{color:#666}h2{margin:.2em}</style>
<h2 id=pos></h2><p>Is this a <b>bass hit</b> (a short low bass note or 808)? A kick drum, impact or synth stab is <b>not</b>.</p>
<p><button id=b>B &nbsp;Bass hit</button> <button id=n>N &nbsp;Not bass</button> <button id=u>U &nbsp;Unsure</button></p>
<p><button id=r style="width:auto;padding:8px 18px">R replay</button> <button id=z style="width:auto;padding:8px 18px">Z undo</button></p>
<audio id=a autoplay></audio><p id=msg></p>
<script>
let order=[],rev={},i=0;const $=id=>document.getElementById(id);
async function init(){const s=await (await fetch('/state')).json();order=s.order;rev=s.reviews;i=order.findIndex(x=>!(x in rev));show()}
function show(){if(i<0||i>=order.length){$('pos').textContent='All done';$('a').removeAttribute('src');$('msg').textContent=Object.keys(rev).length+' reviewed. You can close this tab.';return}
$('pos').textContent='Clip '+(Object.keys(rev).length+1)+' of '+order.length;$('a').src='/audio/'+order[i]+'.ogg';$('msg').textContent=''}
async function put(v){const id=order[i];if(!id)return;rev[id]=v;await fetch('/review',{method:'POST',body:JSON.stringify({id,value:v})});i++;show()}
async function undo(){if(i<=0)return;i--;const id=order[i];delete rev[id];await fetch('/review',{method:'POST',body:JSON.stringify({id,value:null})});show()}
$('b').onclick=()=>put('bass');$('n').onclick=()=>put('not-bass');$('u').onclick=()=>put('unsure');$('r').onclick=()=>$('a').play();$('z').onclick=undo;
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(k==='b')put('bass');else if(k==='n')put('not-bass');else if(k==='u')put('unsure');else if(k==='r')$('a').play();else if(k==='z')undo()});
init()</script>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, body, ctype='application/json'):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == '/': return self.send(PAGE, 'text/html; charset=utf-8')
        if self.path == '/state': return self.send(json.dumps({'order': ORDER, 'reviews': load()}))
        if self.path.startswith('/audio/'):
            name = os.path.basename(self.path[7:]); p = f'{D}/{name}'
            if name.endswith('.ogg') and os.path.exists(p): return self.send(open(p, 'rb').read(), 'audio/ogg')
        self.send_response(404); self.end_headers()
    def do_POST(self):
        if self.path != '/review': self.send_response(404); self.end_headers(); return
        q = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if q['id'] not in ORDER or q['value'] not in ('bass', 'not-bass', 'unsure', None): self.send_response(400); self.end_headers(); return
        r = load()
        if q['value'] is None: r.pop(q['id'], None)
        else: r[q['id']] = q['value']
        tmp = RV + '.tmp'; json.dump(r, open(tmp, 'w'), indent=1); os.replace(tmp, RV)
        self.send('{}')

print(f'{len(ORDER)} clips. Open http://127.0.0.1:{PORT}/'); HTTPServer(('127.0.0.1', PORT), H).serve_forever()
