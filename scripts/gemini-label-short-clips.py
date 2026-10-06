"""Asks Gemini to listen to every clip of the short-clip test set v2 and answer the SAME eleven yes/no/unsure
questions the human review page asks (bass hit, kick, snare, clap, hi-hat, synth hit, impact, whoosh,
vinyl scratch, beatbox, voice), all in one call per clip, with the catalog description of each sound.

Answers go to <review dir>/gemini-<model>.json with provenance "Gemini guess (not a human confirmation)".
The human reviews file is never touched. Resumable: answered clips are skipped. Gemini is not a detector
under test, but it is also not a person: build-short-clip-test-v2.py decides, per question and by a rule
written down beforehand, whether its answers may stand in for missing human labels.

Earlier yardstick (scripts/score-gemini-yardstick.py): gemini-3.1-pro-preview got 36 of 48 expert-labelled
FSD50K clips right, below the 40/48 pass rule set for a labeller.

Usage: GEMINI_API_KEY=$(pbpaste) python3 scripts/gemini-label-short-clips.py <review dir> [model]   (WORKERS=2)
"""
import base64, json, os, re, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

REVIEW = sys.argv[1]; MODEL = sys.argv[2] if len(sys.argv) > 2 else 'gemini-3.1-pro-preview'
WORKERS = int(os.environ.get('WORKERS', '2'))
KEY = (os.environ.get('GEMINI_API_KEY') or sys.exit('Set GEMINI_API_KEY, e.g. GEMINI_API_KEY=$(pbpaste)')).strip()
if not re.fullmatch(r'[A-Za-z0-9_.\-]{20,}', KEY): sys.exit('GEMINI_API_KEY does not look like an API key.')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(REVIEW, f'gemini-{MODEL}.json')
QUESTIONS = [('production', 'bass hit'), ('production', 'kick'), ('production', 'snare'), ('production', 'clap'), ('production', 'hi-hat'),
             ('production', 'synth hit'), ('production', 'impact'), ('production', 'whoosh'), ('production', 'vinyl scratch'),
             ('production', 'beatbox'), ('source', 'voice')]
catalog = {(c['group'], c['label']): c for c in json.load(open(f'{ROOT}/src/audio/djCatalog.json'))['categories']}
side = json.load(open(os.path.join(REVIEW, 'sidecar.json')))['clips']
items = [i for i in json.load(open(os.path.join(REVIEW, 'manifest.json')))['items'] if i['id'] in side]
done = json.load(open(OUT)) if os.path.exists(OUT) else {}
lock = threading.Lock()
FIELD = {l: re.sub(r'[^a-z0-9]+', '_', l) for _, l in QUESTIONS}
SCHEMA = {'type': 'OBJECT', 'required': [FIELD[l] for _, l in QUESTIONS] + ['other', 'reason'],
          'properties': {**{FIELD[l]: {'type': 'STRING', 'enum': ['yes', 'no', 'unsure']} for _, l in QUESTIONS},
                         'other': {'type': 'STRING'}, 'reason': {'type': 'STRING'}}}
DESCRIPTIONS = '\n'.join(f'- {l}: {catalog.get((g, l), {}).get("description", l)}' for g, l in QUESTIONS)
PROMPT = ('You are listening to one short clip (under 2.3 seconds) from a music producer\'s sample library. Answer ONLY from what '
          'you hear; you are given no name or folder. For EACH of these eleven sounds say yes if you clearly hear it, no if you '
          'clearly do not, unsure if you cannot tell. A clip can contain several (a bass hit often has a kick-like thump; a '
          'vocal drum imitation is voice and beatbox). A single low bass note is a bass hit even if it also thumps.\n'
          f'{DESCRIPTIONS}\n'
          'Also give "other": any other clearly audible sound in a few words (or "none"), and "reason": one short sentence.')


def ask(item):
    audio = base64.b64encode(open(os.path.join(REVIEW, item['preview']), 'rb').read()).decode()
    body = {'contents': [{'parts': [{'text': PROMPT}, {'inline_data': {'mime_type': 'audio/wav', 'data': audio}}]}],
            'generationConfig': {'responseMimeType': 'application/json', 'responseSchema': SCHEMA, 'temperature': 0}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
    for attempt in range(6):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=180))
            raw = json.loads(r['candidates'][0]['content']['parts'][0]['text'])
            answers = {f'{g}:{l}': raw[FIELD[l]] for g, l in QUESTIONS}
            with lock:
                done[item['id']] = {'answers': answers, 'other': raw.get('other', ''), 'reason': raw.get('reason', ''), 'model': MODEL,
                                    'provenance': 'Gemini guess (not a human confirmation)', 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
                json.dump(done, open(OUT, 'w'), indent=1)
            return
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:200]
            if e.code in (429, 500, 502, 503) and attempt < 5: time.sleep(10 * (attempt + 1)); continue
            print(f'  {item["title"]}: HTTP {e.code} {msg}', flush=True); return
        except Exception as e:   # network blip or an answer that did not match the schema
            if attempt < 5: time.sleep(5 * (attempt + 1)); continue
            print(f'  {item["title"]}: {str(e)[:120]}', flush=True); return


todo = [i for i in items if i['id'] not in done]
print(len(todo), 'clips to ask', MODEL, f'({len(done)} already answered)', flush=True)
t0 = time.time()
with ThreadPoolExecutor(WORKERS) as pool:
    for n, _ in enumerate(pool.map(ask, todo), 1):
        if n % 25 == 0: print(f'  {n}/{len(todo)} in {(time.time() - t0) / 60:.1f} min', flush=True)
print(f'done: {len(done)} of {len(items)} answered -> {OUT}', flush=True)
