#!/usr/bin/env python3
"""One-screen blind review for the short-clip test set v2: eleven big toggles, keyboard driven.

Reads and writes the SAME files as Sound Label Studio (manifest.json, sidecar.json, reviews.json under
DJ_REVIEW_DATA), in the same review format, so scripts/build-short-clip-test-v2.py freeze needs no change
and confirmations made in either tool count. Never touches the shipped model.

Keys: 1-9, 0, V toggle a sound (once = heard, twice = unsure, three times = off) · Space replay ·
Enter confirm and go to the next unreviewed clip · Backspace previous · S skip for now.
Usage: DJ_REVIEW_DATA=artifacts/music-evaluation/short-clip-test-v2-review python3 scripts/short-clip-review-server.py  (port 8769)
"""
import json, os, re, secrets, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get('DJ_REVIEW_DATA', ROOT / 'artifacts/music-evaluation/short-clip-test-v2-review')).resolve()
PORT = int(os.environ.get('DJ_REVIEW_PORT', '8769'))
TOKEN = secrets.token_urlsafe(24)
LOCK = threading.Lock()
GROUPS = ('source', 'production', 'character')
QUESTIONS = [('production', 'bass hit', '1'), ('production', 'kick', '2'), ('production', 'snare', '3'), ('production', 'clap', '4'),
             ('production', 'hi-hat', '5'), ('production', 'synth hit', '6'), ('production', 'impact', '7'), ('production', 'whoosh', '8'),
             ('production', 'vinyl scratch', '9'), ('production', 'beatbox', '0'), ('source', 'voice', 'V')]
# Pre-ticked guesses come from the folder / uploader-tag hint the clip was selected by (sidecar.json), never from
# the detectors being measured. The listener agrees or fixes; the saved review records that it was hint-assisted.
HINT_PREFILL = {'808 bass': [('production', 'bass hit')], 'sub bass': [('production', 'bass hit')], 'synth bass': [('production', 'bass hit')],
                'acid bass': [('production', 'bass hit')], 'kick': [('production', 'kick')], 'snare': [('production', 'snare')],
                'clap': [('production', 'clap')], 'synth stab': [('production', 'synth hit')], 'impact': [('production', 'impact')],
                'whoosh': [('production', 'whoosh')], 'vinyl scratch': [('production', 'vinyl scratch')],
                'vocal one-shot': [('source', 'voice')], 'vocal drum imitation': [('source', 'voice'), ('production', 'beatbox')]}
CATALOG = json.loads((ROOT / 'src/audio/djCatalog.json').read_text())['categories']
ALLOWED = {g: {c['label'] for c in CATALOG if c['group'] == g} for g in GROUPS}


def read(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write(path, data):
    tmp = path.with_suffix(path.suffix + '.tmp'); tmp.write_text(json.dumps(data, indent=2) + '\n'); tmp.replace(path)


def validate(review):
    """Same shape Sound Label Studio saves: labels per group, per-label decisions, confirmed flag, label snapshot."""
    if not isinstance(review, dict) or not isinstance(review.get('labels'), dict) or not isinstance(review.get('confirmed'), bool): raise ValueError('bad review')
    labels = {}
    for g in GROUPS:
        vals = review['labels'].get(g, [])
        if not isinstance(vals, list) or any(v not in ALLOWED[g] for v in vals): raise ValueError('unknown label')
        labels[g] = list(dict.fromkeys(vals))
    decisions = review.get('decisions', {})
    if not isinstance(decisions, dict) or any(k.split(':', 1)[0] not in GROUPS or k.split(':', 1)[1] not in ALLOWED[k.split(':', 1)[0]] or v not in ('absent', 'unsure') for k, v in decisions.items()): raise ValueError('bad decision')
    assist = review.get('assist')
    if assist is not None and not (isinstance(assist, dict) and len(json.dumps(assist)) < 3000): raise ValueError('bad assist record')
    present = [f'{g}:{v}' for g in GROUPS for v in labels[g]]
    known = list(dict.fromkeys(present + [f'{g}:{l}' for g, l, _ in QUESTIONS] + list(decisions)))
    return {'labels': labels, 'decisions': decisions, 'confirmed': review['confirmed'], 'knownLabels': known,
            'reviewStatus': 'confirmed' if review['confirmed'] else ('uncertain' if review.get('skipped') else 'pending'),
            'labelProvenance': 'explicit human confirmation', 'tool': 'short-clip-review-server', **({'assist': assist} if assist else {})}


PAGE = r'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Short-clip review</title>
<style>
:root{--bg:#0f1220;--card:#181c2e;--fg:#e8eaf3;--mute:#9aa0b8;--on:#2fbf71;--unsure:#e3a21a;--line:#2a3050}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:16px}
h1{font-size:18px;margin:0 0 6px}.sub{color:var(--mute);margin:0 0 10px}
progress{width:100%;height:10px}
.player{display:flex;gap:12px;align-items:center;margin:14px 0}
button{font:inherit;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:14px 16px;cursor:pointer}
button:focus-visible{outline:3px solid #7aa2ff}
.big{font-size:20px;padding:18px 22px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin:10px 0 16px}
.tog{display:flex;justify-content:space-between;align-items:center;min-height:64px;text-align:left}
.tog .key{color:var(--mute);font-size:13px;border:1px solid var(--line);border-radius:6px;padding:1px 7px}
.tog.on{background:var(--on);border-color:var(--on);color:#06281a}.tog.on .key{color:#06281a;border-color:#06281a}
.tog.guess{border-color:#7aa2ff;background:#1e2a4a;box-shadow:inset 0 0 0 2px #7aa2ff}.tog.guess .key{color:#9fc0ff;border-color:#7aa2ff}
.tog.unsure{background:var(--unsure);border-color:var(--unsure);color:#2b1f00}.tog.unsure .key{color:#2b1f00;border-color:#2b1f00}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.other{margin:6px 0 14px;color:var(--mute)}input{font:inherit;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);min-width:260px}
.chip{display:inline-block;margin:4px 6px 0 0;padding:4px 10px;border-radius:999px;background:#243055}
.saved{color:var(--mute);min-height:1.4em}
kbd{color:var(--mute)}
</style>
<main>
<h1 id="title">Loading…</h1>
<p class="sub" id="sub"></p>
<progress id="bar" max="1" value="0"></progress>
<div class="player"><button class="big" id="play">▶ Play <kbd>Space</kbd></button><audio id="audio" preload="auto"></audio><span id="len" class="sub"></span></div>
<p class="sub">Blue = my guess from the clip's source folder. Tap a wrong guess once to clear it. Tap a grey sound to add it; tap again for unsure, again to clear. Enter confirms the ticks and guesses.</p>
<div class="grid" id="grid"></div>
<div class="other">Other sound you clearly hear: <input id="other" list="labels" placeholder="type a sound, press Enter"><datalist id="labels"></datalist><div id="extras"></div></div>
<div class="row"><button class="big" id="confirm">✔ Confirm → next <kbd>Enter</kbd></button><button id="skip">Skip for now <kbd>S</kbd></button><button id="prev">← Previous <kbd>⌫</kbd></button><button id="next">Next unreviewed →</button></div>
<p class="saved" id="saved"></p>
</main>
<script>
const Q=__QUESTIONS__, CAT=__CATALOG__, TOKEN=__TOKEN__;
let manifest, reviews, current=0; const guesses={};   // clip id -> Set of 'group:label' still pre-ticked (client side only)
const el=id=>document.getElementById(id);
const key=(g,l)=>g+':'+l;
const groupOf=l=>CAT.find(c=>c.label===l)?.group;
async function load(){const r=await fetch('/api/state');({manifest,reviews}=await r.json());
 const dl=el('labels');for(const c of CAT){const o=document.createElement('option');o.value=c.label;dl.append(o);}
 current=manifest.items.findIndex(i=>!reviews[i.id]?.confirmed);if(current<0)current=0;render();}
function state(item){const r=reviews[item.id]||{labels:{source:[],production:[],character:[]},decisions:{}};return {labels:JSON.parse(JSON.stringify(r.labels)),decisions:{...(r.decisions||{})}};}
// Guesses apply to clips with no saved labels yet: never reviewed, or skipped / drafted with nothing ticked. Confirmed clips keep what you saved.
function untouched(r){return !r||(!r.confirmed&&!Object.values(r.labels||{}).some(a=>a.length)&&!Object.keys(r.decisions||{}).length);}
function guessSet(item){if(!(item.id in guesses))guesses[item.id]=new Set(untouched(reviews[item.id])?(item.prefill||[]).map(([g,l])=>key(g,l)):[]);return guesses[item.id];}
function render(){const item=manifest.items[current];if(!item)return;const st=state(item);
 const done=manifest.items.filter(i=>reviews[i.id]?.confirmed).length;
 el('title').textContent=`Clip ${current+1} of ${manifest.items.length}`;el('sub').textContent=`${done} confirmed · ${manifest.items.length-done} to go`+(reviews[item.id]?.confirmed?' · this clip is confirmed':'');
 el('bar').value=done/manifest.items.length;el('len').textContent=`${item.seconds.toFixed(2)} s`;
 const a=el('audio');a.src=item.preview;a.load();a.play().catch(()=>{});
 const g=el('grid');g.replaceChildren();
 for(const [grp,label,k] of Q){const b=document.createElement('button');b.className='tog';b.dataset.key=k;const on=st.labels[grp].includes(label),un=st.decisions[key(grp,label)]==='unsure';
  const guess=!on&&!un&&guessSet(item).has(key(grp,label));
  if(on)b.classList.add('on');else if(un)b.classList.add('unsure');else if(guess)b.classList.add('guess');
  b.innerHTML=`<span>${label}${on?' · heard':un?' · unsure':guess?' · guess':''}</span><span class="key">${k}</span>`;b.onclick=()=>toggle(grp,label);g.append(b);}
 const ex=el('extras');ex.replaceChildren();for(const grp of Object.keys(st.labels))for(const l of st.labels[grp]){if(Q.some(q=>q[0]===grp&&q[1]===l))continue;const c=document.createElement('span');c.className='chip';c.textContent=l+' ✕';c.onclick=()=>{st.labels[grp]=st.labels[grp].filter(x=>x!==l);save(item,st,false);};ex.append(c);}
 el('saved').textContent='';}
function toggle(grp,label){const item=manifest.items[current];const st=state(item);const k=key(grp,label);
 const gs=guessSet(item);if(gs.has(k)){gs.delete(k);render();return;}   // a wrong guess clears in one tap
 if(st.labels[grp].includes(label)){st.labels[grp]=st.labels[grp].filter(x=>x!==label);st.decisions[k]='unsure';}
 else if(st.decisions[k]==='unsure'){delete st.decisions[k];}
 else{st.labels[grp].push(label);delete st.decisions[k];}
 save(item,st,false);}
async function save(item,st,confirmed,skipped=false){
 const gs=guessSet(item);let assist=null;
 if(confirmed&&(item.prefill||[]).length){for(const k of gs){const [g,l]=k.split(':');if(!st.labels[g].includes(l))st.labels[g].push(l);}
  assist={mode:'folder-hint',prefill:item.prefill.map(([g,l])=>g+':'+l),kept:[...gs],cleared:item.prefill.map(([g,l])=>g+':'+l).filter(x=>!gs.has(x))};gs.clear();}
 const body={id:item.id,review:{labels:st.labels,decisions:st.decisions,confirmed,skipped,...(assist?{assist}:{})}};
 const r=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':TOKEN},body:JSON.stringify(body)});
 const j=await r.json();if(!r.ok){el('saved').textContent='Not saved: '+(j.error||r.status);return;}reviews[item.id]=j.review;render();el('saved').textContent=confirmed?'Saved ✔':'';}
function nextUnreviewed(){for(let o=1;o<=manifest.items.length;o++){const i=(current+o)%manifest.items.length;if(!reviews[manifest.items[i].id]?.confirmed){current=i;render();return;}}el('saved').textContent='All clips confirmed. You can close this page.';}
el('confirm').onclick=async()=>{const item=manifest.items[current];await save(item,state(item),true);nextUnreviewed();};
el('skip').onclick=async()=>{const item=manifest.items[current];await save(item,state(item),false,true);nextUnreviewed();};
el('next').onclick=nextUnreviewed;el('prev').onclick=()=>{if(current>0){current--;render();}};
el('play').onclick=()=>{const a=el('audio');a.currentTime=0;a.play();};
el('other').addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();e.stopPropagation();const l=el('other').value.trim();const grp=groupOf(l);if(!grp){el('saved').textContent='Unknown sound name';return;}const item=manifest.items[current];const st=state(item);if(!st.labels[grp].includes(l))st.labels[grp].push(l);el('other').value='';save(item,st,false);});
document.addEventListener('keydown',e=>{if(e.target===el('other'))return;const k=e.key.toUpperCase();
 if(k===' '){e.preventDefault();el('play').click();}else if(k==='ENTER'){e.preventDefault();el('confirm').click();}else if(k==='BACKSPACE'){e.preventDefault();el('prev').click();}else if(k==='S'){el('skip').click();}
 else{const q=Q.find(q=>q[2]===k);if(q){e.preventDefault();toggle(q[0],q[1]);}}});
load();
</script></html>'''


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def json(self, data, code=200):
        raw = json.dumps(data).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        if self.headers.get('Host') != f'127.0.0.1:{PORT}': return self.json({'error': 'invalid host'}, 403)
        path = urlparse(self.path).path
        if path == '/':
            page = PAGE.replace('__QUESTIONS__', json.dumps(QUESTIONS)).replace('__CATALOG__', json.dumps([{'group': c['group'], 'label': c['label']} for c in CATALOG])).replace('__TOKEN__', json.dumps(TOKEN)).encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(page))); self.end_headers(); return self.wfile.write(page)
        if path == '/api/state':
            # Only the blind set (sidecar.json) is reviewed here, in its fixed order; anything another tool appended is ignored.
            with LOCK:
                blind = read(DATA / 'sidecar.json', {'clips': {}})['clips']
                manifest = read(DATA / 'manifest.json', {'items': []})
                manifest['items'] = [dict(i, prefill=[list(x) for x in HINT_PREFILL.get(blind[i['id']]['hint'], [])]) for i in manifest['items'] if i['id'] in blind]
                return self.json({'manifest': manifest, 'reviews': read(DATA / 'reviews.json', {})})
        m = re.fullmatch(r'/audio/([a-f0-9]+\.wav)', path)
        if m and (DATA / 'audio' / m.group(1)).exists():
            raw = (DATA / 'audio' / m.group(1)).read_bytes(); self.send_response(200); self.send_header('Content-Type', 'audio/wav'); self.send_header('Content-Length', str(len(raw))); self.end_headers(); return self.wfile.write(raw)
        return self.json({'error': 'not found'}, 404)
    def do_POST(self):
        if self.headers.get('Host') != f'127.0.0.1:{PORT}' or self.headers.get('X-Review-Token') != TOKEN: return self.json({'error': 'refresh the page'}, 403)
        if urlparse(self.path).path != '/api/review': return self.json({'error': 'not found'}, 404)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 1_000_000: raise ValueError('too large')
            data = json.loads(self.rfile.read(size)); review = validate(data['review'])
            with LOCK:
                ids = {i['id'] for i in read(DATA / 'manifest.json', {'items': []})['items']}
                if data['id'] not in ids: raise ValueError('unknown clip')
                reviews = read(DATA / 'reviews.json', {}); reviews[data['id']] = review; write(DATA / 'reviews.json', reviews)
            return self.json({'review': review})
        except Exception as e:
            return self.json({'error': str(e)}, 400)


if __name__ == '__main__':
    print(f'Short-clip review: http://127.0.0.1:{PORT}  data: {DATA}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
