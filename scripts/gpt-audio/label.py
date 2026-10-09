"""Asks OpenAI's gpt-audio-1.5 to label judge-set clips, to see whether it beats the app's own detectors.

Usage: OPENAI_API_KEY=... python3 scripts/gpt-audio/label.py <task> <manifest> <audio dir> <out.json> [options]
  task: instruments (OpenMIC DJ clip manifests), effects (dj-effects clips.json, held-out round 1 only) or key
        (GiantSteps MTG key manifest).
  --limit N       label at most N clips, picked by a seeded hash (label-blind), default: all
  --max-usd X     stop once the measured spend reaches X dollars (default 2)
  --model NAME    default gpt-audio-1.5
  --workers N     parallel requests (default 4)

Judge-only: these sets are for scoring, never for tuning prompts or thresholds. The prompt below was written once,
before any answers were seen. Each clip is sent as at most 10 s of 16 kHz mono WAV (cut with ffmpeg). Answers are
forced through a function call whose arguments use fixed choice lists, so they compare one to one with the app's tags.
Resumable: clips already in <out.json> are skipped. Cost comes from each response's usage, at the list prices below.
"""
import base64, hashlib, json, os, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

# USD per token, from https://developers.openai.com/api/docs/models/gpt-audio-1.5 (checked 2026-10-09).
PRICE = {'audio_in': 32e-6, 'text_in': 2.5e-6, 'text_out': 10e-6}
INSTRUMENTS = ['drums', 'cymbals', 'bass', 'synthesizer', 'piano', 'organ', 'guitar', 'violin', 'trumpet', 'saxophone', 'voice']
EFFECTS = ['chops', 'vocal chops', 'stutter effect', 'glitch effect', 'reverse effect', 'record stop', 'vinyl scratch', 'riser',
           'downlifter', 'impact', 'whoosh', 'reverse cymbal', 'noise sweep', 'sub drop', 'laser', 'siren', 'air horn', 'flanged',
           'bitcrushed', 'filter sweep', 'trance gate']
KEYS = [f'{t} {m}' for m in ('major', 'minor') for t in ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']]

PROMPTS = {
    'instruments': (
        'You are tagging a 10 second music clip for a DJ library. Listen and list every instrument or sound source from the '
        'list that is clearly audible anywhere in the clip. "bass" means any bass part (bass guitar, double bass or synth bass). '
        '"drums" means a drum kit or drum machine; "cymbals" means any cymbal or hi-hat. "voice" means any human singing or '
        'speech. Leave out anything you are not confident you hear. An empty list is allowed.',
        {'present': {'type': 'array', 'items': {'type': 'string', 'enum': INSTRUMENTS}}}),
    'effects': (
        'You are tagging a short sound from a producer\'s sample library. List every DJ or production effect from the list that '
        'this sound clearly is or clearly contains. Most plain instrument loops, songs and everyday sounds contain none of them: '
        'then return an empty list. Leave out anything you are not confident about.',
        {'present': {'type': 'array', 'items': {'type': 'string', 'enum': EFFECTS}}}),
    'key': (
        'This is a 10 second excerpt of an electronic dance music track. What is its musical key (tonic and mode)? '
        'Give your single best answer.',
        {'key': {'type': 'string', 'enum': KEYS}}),
}


def items_for(task, manifest):
    m = json.load(open(manifest))
    if task == 'effects':
        return [{'id': c['id'], 'url': c['preview']} for c in m['clips'] if c['split'] == 'heldout' and c['round'] == 1]
    return [{'id': it['id']} for it in m['items']]


def wav_bytes(task, item, audio_dir):
    src = item.get('url') or next((os.path.join(audio_dir, f) for f in os.listdir(audio_dir)
                                    if os.path.splitext(f)[0] == item['id']), None)
    if not src: raise FileNotFoundError(f"no audio for {item['id']} in {audio_dir}")
    with tempfile.NamedTemporaryFile(suffix='.wav') as out:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-t', '10', '-ac', '1', '-ar', '16000', out.name], check=True,
                       timeout=180)
        return open(out.name, 'rb').read()


def ask(model, key, task, audio):
    text, props = PROMPTS[task]
    fn = {'name': 'answer', 'description': 'Report what you hear.',
          'parameters': {'type': 'object', 'properties': props, 'required': list(props), 'additionalProperties': False}}
    body = {'model': model, 'modalities': ['text'], 'temperature': 0,
            'messages': [{'role': 'user', 'content': [
                {'type': 'text', 'text': text},
                {'type': 'input_audio', 'input_audio': {'data': base64.b64encode(audio).decode(), 'format': 'wav'}}]}],
            'tools': [{'type': 'function', 'function': fn}],
            'tool_choice': {'type': 'function', 'function': {'name': 'answer'}}}
    req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    for attempt in range(6):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=180)); break
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')[:400]
            if e.code in (429, 500, 502, 503, 504) and attempt < 5 and 'insufficient_quota' not in msg:
                time.sleep(2 ** attempt * 3); continue
            raise SystemExit(f'OpenAI refused ({e.code}): {msg}')
    call = r['choices'][0]['message']['tool_calls'][0]['function']
    u = r.get('usage', {}); details = u.get('prompt_tokens_details') or {}
    audio_in = details.get('audio_tokens', 0); text_in = u.get('prompt_tokens', 0) - audio_in; out = u.get('completion_tokens', 0)
    cost = audio_in * PRICE['audio_in'] + text_in * PRICE['text_in'] + out * PRICE['text_out']
    return {'answer': json.loads(call['arguments']), 'usage': {'audioIn': audio_in, 'textIn': text_in, 'out': out}, 'usd': cost}


def main():
    args = sys.argv[1:]
    opt = lambda name, default: (args.pop(args.index(name) + 1), args.remove(name))[0] if name in args else default
    limit = int(opt('--limit', 0)); max_usd = float(opt('--max-usd', 2)); model = opt('--model', 'gpt-audio-1.5')
    workers = int(opt('--workers', 4))
    task, manifest, audio_dir, out_path = args
    if task not in PROMPTS: sys.exit(f'task must be one of {list(PROMPTS)}')
    key = (os.environ.get('OPENAI_API_KEY') or '').strip() or sys.exit('Set OPENAI_API_KEY.')
    items = sorted(items_for(task, manifest), key=lambda it: hashlib.sha256(f"dge-gpt-audio|{it['id']}".encode()).hexdigest())
    if limit: items = items[:limit]
    done = json.load(open(out_path)) if os.path.exists(out_path) else {'model': model, 'task': task, 'answers': {}}
    todo = [it for it in items if it['id'] not in done['answers']]
    spent = sum(a['usd'] for a in done['answers'].values()); lock = threading.Lock(); failures = []
    print(f'{task}: {len(items)} clips, {len(todo)} to label, ${spent:.3f} already spent, cap ${max_usd}')

    def one(it):
        nonlocal spent
        with lock:
            if spent >= max_usd: return
        try: a = ask(model, key, task, wav_bytes(task, it, audio_dir))
        except (subprocess.SubprocessError, FileNotFoundError, urllib.error.URLError, KeyError, ValueError) as e:
            failures.append(f"{it['id']}: {e}"); return
        with lock:
            done['answers'][it['id']] = a; spent += a['usd']
            if len(done['answers']) % 25 == 0:
                json.dump(done, open(out_path, 'w'), indent=1); print(f"  {len(done['answers'])} labelled, ${spent:.3f}")

    with ThreadPoolExecutor(workers) as pool: list(pool.map(one, todo))
    json.dump(done, open(out_path, 'w'), indent=1)
    n = len(done['answers'])
    print(f"done: {n} labelled, {len(failures)} failed, ${spent:.3f} spent (${spent / max(n, 1):.4f} per clip)"
          f"{'; stopped at the cost cap' if spent >= max_usd else ''}")
    for f in failures[:10]: print('  failed', f)


if __name__ == '__main__':
    main()
