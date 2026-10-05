"""Asks Gemini to listen to every clip in the DJ test set and answer the same questions as the
listening page (what it is, more specific, effects, instruments). Answers go to gemini.json next
to labels.json; human labels are never touched. Resumable: clips already answered are skipped.
Gemini's answers are a first pass, not the answer key: the clips where Gemini and the app's
detectors disagree are queued for a human to check.
Usage: GEMINI_API_KEY=... gemini-label-test-set.py <test set dir> [model]"""
import json, os, sys, re, base64, urllib.request, urllib.error, time, threading
from concurrent.futures import ThreadPoolExecutor
ROOT = sys.argv[1]; MODEL = sys.argv[2] if len(sys.argv) > 2 else 'gemini-3.8-flash'
WORKERS = int(os.environ.get('WORKERS', '1'))      # free-tier keys allow only a few requests a minute
KEY = os.environ.get('GEMINI_API_KEY') or sys.exit('Set GEMINI_API_KEY (for example GEMINI_API_KEY=$(pbpaste)).')
KEY = KEY.strip()
if not re.fullmatch(r'[A-Za-z0-9_.\-]{20,}', KEY):       # e.g. the clipboard held something else
    sys.exit('GEMINI_API_KEY does not look like an API key. Copy the key from https://aistudio.google.com/apikey and run again.')
# The default model writes gemini.json; any other model gets its own file so runs can be compared.
OUT = os.path.join(ROOT, 'gemini.json' if len(sys.argv) <= 2 else f'gemini-{MODEL}.json')
# The same choices as scripts/dj-test-set/index.html, so answers compare one to one.
FAMILIES = ['drum hit', 'drum loop', 'bass', 'synth', 'vocal', 'fx', 'texture', 'unsure']
DETAILS = ['kick', 'snare', 'clap', 'hi-hat', 'cymbal', 'tom', 'other percussion', 'full drum loop', 'top loop', 'percussion loop',
           'drum fill', 'breakbeat', '808', 'sub bass', 'reese', 'wobble / growl', 'other bass', 'lead', 'pluck', 'pad', 'chord', 'stab',
           'arp', 'chop', 'phrase', 'ad-lib / shout', 'chant / choir', 'riser', 'downlifter', 'impact', 'whoosh / sweep', 'glitch',
           'other fx', 'ambience', 'drone', 'foley', 'noise']
EFFECTS = ['reverb', 'delay / echo', 'distorted']
INSTRUMENTS = ['piano', 'electric piano', 'organ', 'acoustic guitar', 'electric guitar', 'bass guitar', 'strings', 'brass', 'woodwind',
               'mallet instrument', 'synthesizer', 'drums', 'none']
PROMPT = """You are labelling a short audio clip from a music producer's sample library.
Answer only from what you hear.
- family: the ONE main kind of sound. drum hit = a single drum or percussion hit. drum loop = a repeating drum/percussion pattern.
  bass = a bass sound or bass line. synth = any melodic or harmonic part (synth, keys, guitar, strings...). vocal = a human voice.
  fx = a transition or sound effect (riser, impact, sweep, glitch). texture = ambience, drone, noise or foley. unsure = you cannot tell.
- details: more specific types you are confident about; may be empty.
- effects: only effects that are clearly audible; may be empty.
- instruments: real or sampled instruments you can hear. Use "synthesizer" for electronic synth sounds and "drums" for any drum
  sounds. Use ["none"] when no listed instrument is present (for example a pure vocal or a noise sweep).
- confidence: how sure you are about family, 0 to 1."""
SCHEMA = {'type': 'OBJECT', 'properties': {
    'family': {'type': 'STRING', 'enum': FAMILIES},
    'details': {'type': 'ARRAY', 'items': {'type': 'STRING', 'enum': DETAILS}},
    'effects': {'type': 'ARRAY', 'items': {'type': 'STRING', 'enum': EFFECTS}},
    'instruments': {'type': 'ARRAY', 'items': {'type': 'STRING', 'enum': INSTRUMENTS}},
    'confidence': {'type': 'NUMBER'}}, 'required': ['family', 'details', 'effects', 'instruments', 'confidence']}

# Some models (e.g. gemini-omni-*) only accept the newer Interactions API; switched on automatically.
INTERACTIONS = os.environ.get('INTERACTIONS') == '1'
def json_schema(x):
    """generateContent's upper-case schema types -> the standard JSON Schema the Interactions API takes."""
    if isinstance(x, dict): return {k: (v.lower() if k == 'type' else json_schema(v)) for k, v in x.items()}
    return [json_schema(v) for v in x] if isinstance(x, list) else x

def request(audio):
    if INTERACTIONS:
        body = {'model': MODEL, 'input': [{'type': 'text', 'text': PROMPT}, {'type': 'audio', 'data': audio, 'mime_type': 'audio/mp3'}],
                'response_format': {'type': 'text', 'mime_type': 'application/json', 'schema': json_schema(SCHEMA)}, 'store': False}
        url, extra = 'https://generativelanguage.googleapis.com/v1beta/interactions', {'Api-Revision': '2026-05-20'}
    else:
        body = {'contents': [{'parts': [{'text': PROMPT}, {'inline_data': {'mime_type': 'audio/mp3', 'data': audio}}]}],
                'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': SCHEMA, 'temperature': 0}}
        url, extra = f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent', {}
    return urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY, **extra})

def answer_text(r):
    if not INTERACTIONS: return r['candidates'][0]['content']['parts'][0]['text']
    if r.get('output_text'): return r['output_text']
    return [c['text'] for st in r['steps'] if st.get('type') == 'model_output' for c in st.get('content', []) if c.get('type') == 'text'][-1]

def ask(clip_id):
    global INTERACTIONS
    audio = base64.b64encode(open(os.path.join(ROOT, 'audio', clip_id + '.mp3'), 'rb').read()).decode()
    for attempt in range(8):
        try:
            r = json.load(urllib.request.urlopen(request(audio), timeout=180))
            answer = json.loads(answer_text(r))
            answer['instruments'] = ['none'] if 'none' in answer['instruments'] else answer['instruments']
            return {**answer, 'model': MODEL}
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors='replace')
            if e.code == 429 and ('PerDay' in text or 'per day' in text.lower()):
                os._exit(print(f'\nDaily Gemini quota used up. Answers so far are saved; rerun tomorrow to continue.\n{text[:400]}') or 1)
            if e.code in (429, 500, 503) and attempt < 7:
                # Google says how long to wait ("retryDelay": "37s"); use it, else back off.
                m = re.search(r'"retryDelay":\s*"(\d+)', text); wait = int(m.group(1)) + 1 if m else min(60, 5 * 2 ** attempt)
                print(f'\r  rate limited, waiting {wait}s...' + ' ' * 20, end='', flush=True); time.sleep(wait); continue
            if e.code == 400 and 'only supports Interactions API' in text and not INTERACTIONS:
                INTERACTIONS = True; continue
            if e.code == 404:                               # wrong model name: show the ones this key can use
                listing = json.load(urllib.request.urlopen(urllib.request.Request(
                    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', headers={'x-goog-api-key': KEY})))
                names = [m['name'].split('/')[-1] for m in listing.get('models', []) if 'generateContent' in m.get('supportedGenerationMethods', [])]
                os._exit(print(f'\nNo model called {MODEL}. Models this key can use:\n  ' + '\n  '.join(n for n in names if 'gemini' in n)) or 1)
            os._exit(print(f'\nGemini refused ({e.code}): {text[:400]}') or 1)
        except (KeyError, IndexError, json.JSONDecodeError, OSError):   # OSError covers socket timeouts on Python 3.9
            if attempt < 4: time.sleep(2); continue
            return None

clips = [c['id'] for c in json.load(open(os.path.join(ROOT, 'clips.json')))['clips']]
done = json.load(open(OUT)) if os.path.exists(OUT) else {}
todo = [c for c in clips if c not in done]; lock = threading.Lock()
print(f'{len(clips)} clips, {len(done)} already answered, {len(todo)} to ask {MODEL}', flush=True)
def one(cid):
    a = ask(cid)
    with lock:
        if a: done[cid] = a
        tmp = OUT + '.tmp'; json.dump(done, open(tmp, 'w'), indent=1); os.replace(tmp, OUT)   # saved after every clip
        n = len(done); bar = '#' * (30 * n // len(clips))
        print(f'\r  [{bar:<30}] {n} of {len(clips)}  ({time.time() - START:.0f}s)', end='', flush=True)   # one line, rewritten per clip
START = time.time()
with ThreadPoolExecutor(WORKERS) as pool: list(pool.map(one, todo))
print(f'\ndone: {len(done)} of {len(clips)} answered -> {OUT}')
