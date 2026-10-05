"""Checks that Gemini really hears a clip: prints how many AUDIO tokens the request carried
(about 32 per second of sound; near zero means the audio was not attached) and asks for a
plain one-sentence description with no forced answer list, to compare with the schema answers.
Usage: GEMINI_API_KEY=... gemini-audio-probe.py <mp3> [<mp3> ...] [--model NAME]"""
import json, os, sys, base64, urllib.request, urllib.error
args = sys.argv[1:]; model = 'gemini-3.8-flash'
if '--model' in args: i = args.index('--model'); model = args[i + 1]; del args[i:i + 2]
KEY = os.environ.get('GEMINI_API_KEY') or sys.exit('Set GEMINI_API_KEY (for example GEMINI_API_KEY=$(pbpaste)).')
for path in args:
    audio = base64.b64encode(open(path, 'rb').read()).decode()
    body = {'contents': [{'parts': [{'text': 'Describe in one sentence what you hear in this audio clip. Name the instrument or sound source.'},
                                    {'inline_data': {'mime_type': 'audio/mp3', 'data': audio}}]}], 'generationConfig': {'temperature': 0}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
    try: r = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e: sys.exit(f'Gemini refused ({e.code}): {e.read().decode(errors="replace")[:500]}')
    tokens = {d['modality']: d['tokenCount'] for d in r.get('usageMetadata', {}).get('promptTokensDetails', [])}
    text = r['candidates'][0]['content']['parts'][0]['text'].strip()
    print(f"{os.path.basename(path)}  [{model}]  audio tokens: {tokens.get('AUDIO', 0)}  (all: {tokens})\n  heard: {text}\n")
