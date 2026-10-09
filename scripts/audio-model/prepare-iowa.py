"""University of Iowa Musical Instrument Samples (MIS) single notes for the tagger's app-named head.

Usage: python3 scripts/audio-model/prepare-iowa.py <out-dir> [--limit N] [--workers 16] [--list]
  -> iowa-mel.npy + iowa.json   one 10 s window per note (train.py pads short notes with silence)
  --list only crawls the pages and prints how many notes each tag would get (no audio, no torch).

Source: https://theremin.music.uiowa.edu/MIS.html ("freely available ... without restrictions"). Both the original pages
and the 2012/2014 single-pitch pages are crawled.

Judge set: 483 of these notes are in the free-tag-set judge set (test only). iowa-judge-exclude.json lists each one's
name key (lower-case name tokens, sorted, without 'stereo'/'mono' and the extension), file sha256 and decoded 32 kHz
mono PCM md5. A note matching any of the three is never read for training. The original pages' multi-note files
(names with a pitch range such as C4B4) hold the same takes the single-pitch pages were cut from, so they are skipped
too (except the guitar page, which has no single-pitch version and no judge note). Found objects and the balloon pop
have no catalog tag and are skipped.

Every note is one instrument, so labels are strong: the note's tags are present, the other tags this source teaches are
absent, except where a tag could be heard in it (percussion and bell for struck instruments) which stay unlabelled.
"""
import argparse, hashlib, html, json, os, re, subprocess, sys, time, urllib.parse, urllib.request, warnings
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import CAT  # noqa: E402

BASE = 'https://theremin.music.uiowa.edu/'
RATE = 32000
h = lambda *p: hashlib.sha256('|'.join(map(str, p)).encode()).hexdigest()

# Page (lower case, without MIS prefix, '2012' and '.html') -> catalog labels.
PAGES = [('altoflute', ['flute']), ('bassflute', ['flute']), ('flute', ['flute']), ('oboe', ['oboe']), ('clarinet', ['clarinet']),
         ('bassoon', ['bassoon']), ('saxophone', ['saxophone']), ('horn', ['horn']), ('trumpet', ['trumpet']), ('trombone', ['trombone']),
         ('tuba', ['tuba']), ('violin', ['violin / fiddle', 'strings']), ('viola', ['viola', 'strings']), ('cello', ['cello', 'strings']),
         ('doublebass', ['double bass', 'strings']), ('marimba', ['marimba', 'mallet instrument']), ('xylophone', ['xylophone', 'mallet instrument']),
         ('vibraphone', ['vibraphone', 'mallet instrument']), ('bells', ['glockenspiel', 'mallet instrument']), ('crotales', ['mallet instrument']),
         ('cymbals', ['cymbal']), ('gong', ['gong']), ('handpercussion', []), ('tambourines', ['tambourine', 'percussion']),
         ('piano', ['piano']), ('guitar', ['guitar', 'acoustic guitar'])]
STRUCK = {'marimba', 'xylophone', 'vibraphone', 'bells', 'crotales', 'cymbals', 'gong', 'handpercussion', 'tambourines'}
# Always-absent tags: none of these is in a solo acoustic note.
BASE_ABSENT = ['voice', 'drums', 'synthesizer', 'electric guitar', 'bass guitar', 'organ', 'electric piano', 'kick', 'snare', 'drum loop',
               'synth bass', '808 bass', 'hi-hat', 'clap']
TAUGHT = sorted(({l for _, ls in PAGES for l in ls} | set(BASE_ABSENT) |
                 {'crash cymbal', 'ride cymbal', 'woodblock', 'clave', 'triangle', 'percussion hit', 'percussion', 'bell'}) & set(CAT))
RANGE = re.compile(r'^[a-g][b#]?-?\d[a-g][b#]?-?\d$')

def extra_module():
    """prepare-extra.py (hyphenated, so not importable by name) for its log-mel Writer."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('prepare_extra', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prepare-extra.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

def name_key(name):
    n = re.sub(r'\.(aiff?|wav)$', '', name.lower())
    return '.'.join(sorted(t.strip() for t in n.split('.') if t.strip() and t.strip() not in ('stereo', 'mono')))

def page_kind(page):
    p = re.sub(r'^(mis-pitches-2012/)?mis', '', page.lower()).replace('2012', '').replace('.html', '')
    for k, ls in PAGES:
        if k in p: return k, ls
    return None, None

def labels_of(kind, base, name):
    present = set(base); low = name.lower()
    if kind == 'cymbals':
        if 'hihat' in low or 'hi-hat' in low: present = {'hi-hat', 'cymbal'}
        elif 'ride' in low: present |= {'ride cymbal'}
        elif 'crash' in low and re.search(r'stick|choke|mallet\.ff', low): present |= {'crash cymbal'}
    if kind == 'handpercussion':
        if re.match(r'[\d.]+wb\.', low): present = {'woodblock', 'percussion hit', 'percussion'}
        elif low.startswith('clave'): present = {'clave', 'percussion hit', 'percussion'}
        elif 'triangle' in low: present = {'triangle', 'percussion'} | ({'percussion hit'} if 'roll' not in low else set())
        else: present = {'percussion hit', 'percussion'}
    lab = {}
    for l in TAUGHT:
        if l in present: lab[f'cat:{l}'] = 1.0
        elif kind in STRUCK and l in ('percussion', 'percussion hit', 'bell', 'cymbal', 'hi-hat', 'mallet instrument', 'glockenspiel'): continue
        elif kind == 'cymbals' and l in ('crash cymbal', 'ride cymbal'): continue
        else: lab[f'cat:{l}'] = 0.0
    return lab

def get(url, binary=True):
    for i in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'dge-tagger-prep'}), timeout=120) as r:
                d = r.read(); return d if binary else d.decode('latin-1')
        except Exception:
            if i == 5: raise
            time.sleep(3 * (i + 1))

def crawl():
    idx = get(BASE + 'MIS.html', False)
    pages = list(dict.fromkeys(p for p in re.findall(r'href="([^"#]+\.html)"', idx) if re.search(r'mis', p, re.I)
                               and p not in ('MIS.html', 'MISPost2012Intro.html')))
    notes = []
    for p in pages:
        kind, base = page_kind(p)
        if kind is None: continue
        u = urllib.parse.urljoin(BASE, p)
        try: t = get(u, False)
        except Exception as e: print(f'  page {p} unreadable: {e}', flush=True); continue
        for href in dict.fromkeys(html.unescape(x) for x in re.findall(r'href="([^"]*\.(?:aif|aiff|wav))"', t, re.I)):
            url = urllib.parse.quote(urllib.parse.urljoin(u, href), safe=':/')
            name = href.split('/')[-1]
            notes.append({'page': p, 'kind': kind, 'base': base, 'url': url, 'name': name, 'key': name_key(name), 'single': '2012' in p})
    return notes

def select(notes, judge):
    jkeys = {j['key'] for j in judge}
    out, seen, why = [], set(), Counter()
    for n in sorted(notes, key=lambda n: (not n['single'], n['url'])):     # single-pitch pages first, so their version is kept
        toks = n['key'].split('.')
        if 'ambient' in toks or 'silence' in toks: why['ambient/silence'] += 1; continue
        if n['kind'] != 'guitar' and any(RANGE.match(t.replace(' ', '')) for t in toks): why['multi-note file'] += 1; continue
        if n['key'] in jkeys: why['judge name'] += 1; continue
        if n['key'] in seen: why['duplicate'] += 1; continue
        seen.add(n['key']); out.append(n)
    return out, why

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--workers', type=int, default=16); ap.add_argument('--list', action='store_true')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    judge = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'iowa-judge-exclude.json')))['files']
    jsha, jpcm = {j['sha256'] for j in judge}, {j['pcm32kMonoMd5'] for j in judge}
    notes, why = select(crawl(), judge)
    print(f'iowa: {len(notes)} notes to read; skipped ' + ', '.join(f'{k} {v}' for k, v in why.items()), flush=True)
    if args.list:
        pos = Counter(l[4:] for n in notes for l, v in labels_of(n['kind'], n['base'], n['name']).items() if v)
        print('positives ' + ', '.join(f'{k} {v}' for k, v in pos.most_common()))
        json.dump([{k: n[k] for k in ('url', 'key', 'kind')} for n in notes], open(os.path.join(args.out, 'iowa-list.json'), 'w'), indent=0)
        return
    if args.limit: notes = notes[:args.limit]
    import numpy as np
    Writer = extra_module().Writer
    def fetch(n):
        try:
            data = get(n['url'])
            if hashlib.sha256(data).hexdigest() in jsha: return n, None, 'judge sha256'
            pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(RATE), '-f', 's16le', 'pipe:1'],
                                 input=data, capture_output=True, check=True).stdout
            if hashlib.md5(pcm).hexdigest() in jpcm: return n, None, 'judge audio'
            x = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
            if len(x) < RATE // 4 or np.abs(x).max() < 1e-3: return n, None, 'silent'
            lead = int(np.argmax(np.abs(x) > 0.01 * np.abs(x).max()))         # MIS notes start after a pause
            x = x[max(0, lead - RATE // 20):][:10 * RATE]
            return n, np.pad(x, (0, 10 * RATE - len(x))), None
        except Exception as e: return n, None, f'error {type(e).__name__}'
    w = Writer(args.out, 'iowa', 1000); skipped = Counter()
    with ThreadPoolExecutor(args.workers) as pool:
        for k, (n, x, err) in enumerate(pool.map(fetch, notes)):
            if err: skipped[err] += 1; continue
            group = re.sub(r'\.(pp|mf|ff)\b', '', n['key'])          # every dynamic of a note stays on one side of the split
            w.add({'id': f'iowa:{n["key"]}', 'artist': f'iowa:{n["kind"]}', 'val': int(h('dge-iowa-val', group)[:8], 16) % 10 == 0,
                   'labels': labels_of(n['kind'], n['base'], n['name']), 'weakAbsent': [], 'source': 'iowa-mis', 'url': n['url']}, x)
            if k % 200 == 0: print(f'  note {k}/{len(notes)}', flush=True)
    print('iowa skipped at read: ' + ', '.join(f'{k} {v}' for k, v in skipped.items()), flush=True)
    w.close('University of Iowa MIS (theremin.music.uiowa.edu, no restrictions); free-tag-set judge notes excluded')

if __name__ == '__main__':
    main()
