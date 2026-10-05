"""Asks Gemini to listen to each clip in a review queue (build-review-queue.py) and answer ONE yes/no question:
is this clip the label it was queued for? The catalog description of the label is included.
Answers go to <queue>/gemini-<model>.json with provenance "Gemini guess"; the human reviews file is never touched.
Resumable. Earlier yardstick: gemini-3.1-pro-preview got 36 of 48 expert-labelled FSD50K clips right.
Usage: GEMINI_API_KEY=$(pbpaste) python3 scripts/gemini-label-queue.py <queue dir> [model]"""
import json, os, sys, re, base64, urllib.request, urllib.error, time, threading
from concurrent.futures import ThreadPoolExecutor
QUEUE = sys.argv[1]; MODEL = sys.argv[2] if len(sys.argv) > 2 else 'gemini-3.1-pro-preview'
WORKERS = int(os.environ.get('WORKERS', '4'))
KEY = (os.environ.get('GEMINI_API_KEY') or sys.exit('Set GEMINI_API_KEY, e.g. GEMINI_API_KEY=$(pbpaste)')).strip()
if not re.fullmatch(r'[A-Za-z0-9_.\-]{20,}', KEY): sys.exit('GEMINI_API_KEY does not look like an API key. Copy it from https://aistudio.google.com/apikey and run again.')
OUT = os.path.join(QUEUE, f'gemini-{MODEL}.json')
catalog = {c['label']: c for c in json.load(open('src/audio/djCatalog.json'))['categories']}
items = json.load(open(os.path.join(QUEUE, 'manifest.json')))['items']
done = json.load(open(OUT)) if os.path.exists(OUT) else {}
lock = threading.Lock()
SCHEMA = {'type': 'OBJECT', 'properties': {'answer': {'type': 'STRING', 'enum': ['yes', 'no', 'unsure']},
          'confidence': {'type': 'NUMBER'}, 'reason': {'type': 'STRING'}}, 'required': ['answer', 'confidence', 'reason']}

def ask(item):
    label = item['folder'].rsplit(' (', 1)[0]
    c = catalog.get(label, {})
    prompt = (f'You are checking one audio clip from a music producer\'s sample library. Answer ONLY from what you hear, '
              f'not from any name. Question: is this clip a "{label}"? Meaning: {c.get("description", label)} '
              f'Answer yes, no, or unsure, with confidence 0-1 and one short reason.')
    audio = base64.b64encode(open(os.path.join(QUEUE, item['preview']), 'rb').read()).decode()
    body = {'contents': [{'parts': [{'text': prompt}, {'inline_data': {'mime_type': 'audio/wav', 'data': audio}}]}],
            'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': SCHEMA, 'temperature': 0}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
    for attempt in range(5):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=120))
            ans = json.loads(r['candidates'][0]['content']['parts'][0]['text'])
            with lock:
                done[item['id']] = {'label': label, **ans, 'model': MODEL, 'provenance': 'Gemini guess (not a human confirmation)'}
                json.dump(done, open(OUT, 'w'), indent=1)
            return
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:200]
            if e.code in (429, 500, 503): time.sleep(10 * (attempt + 1)); continue
            print('error', e.code, msg); return
        except Exception as e:
            time.sleep(5 * (attempt + 1))
    print('gave up on', item['id'])

todo = [i for i in items if i['id'] not in done]
print(len(todo), 'clips to ask', MODEL)
with ThreadPoolExecutor(WORKERS) as pool: list(pool.map(ask, todo))
from collections import Counter
c = Counter((v['label'], v['answer']) for v in done.values())
for l in dict.fromkeys(v['label'] for v in done.values()):
    print(f"{l:<12} yes {c[(l, 'yes')]:>3}  no {c[(l, 'no')]:>3}  unsure {c[(l, 'unsure')]:>3}")
print(f'{len(done)} of {len(items)} answered -> {OUT}')
