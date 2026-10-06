"""Find Creative Commons SoundCloud tracks whose own text names their instruments, and freeze them as a labelled set.

Usage:
  python3 scripts/soundcloud/collect.py search <manifest.json> [max-tracks=720]
  python3 scripts/soundcloud/collect.py relabel <manifest.json>
  python3 scripts/soundcloud/collect.py fetch <manifest.json> <audio-dir> [shard=i/n]

search: queries SoundCloud's public web API (the same one soundcloud.com uses) for instrument and DJ-genre terms,
keeps tracks that are Creative Commons licensed, fully streamable (not 30 s previews), 1-12 minutes long and not on the
earlier online DJ check list, labels them with scripts/soundcloud/labels.py, keeps at most 3 per uploader, and splits
them by a fixed hash of the uploader: about 60% "train" (used to fit thresholds) and 40% "held-out" (only reported).
fetch: downloads each frozen track with yt-dlp and cuts a 30 s excerpt starting 35% into the track. Audio is never
committed. Only standard library + yt-dlp + ffmpeg.
"""
import hashlib, json, os, random, re, subprocess, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from labels import CLASSES, labels_from_text, track_text

SEED = 'dge-soundcloud-train-2026-10-06'
EXCERPT_SECONDS = 30
EXCERPT_AT = 0.35
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
API = 'https://api-v2.soundcloud.com'
# Tracks already used by the online DJ check (scripts/online-dj on claude/project-thread-rjgnlw); kept out so that check stays clean.
EXCLUDE = {
    'https://soundcloud.com/naanmoons/when-the-sun-goes-down-deep-house-free-download-creative-commons-attribution',
    'https://soundcloud.com/danielalves-br/paintingtechno-mix', 'https://soundcloud.com/user-577568682/the-mantra-syntax-5-feat-tcq',
    'https://soundcloud.com/firelightfm/creative-commons-dubstep', 'https://soundcloud.com/josh-dirschka/endless-journey-original-mix',
    'https://soundcloud.com/unwritten-stories/overthinking-creative-commons-free-happy-electronic-music',
    'https://soundcloud.com/charliewalkrich/charlie-walkrich-big-room-serenade-2017-creative-commons-electro-house-edmfree-download',
    'https://soundcloud.com/unwritten-stories/take-me-farcreative-commons-free-hip-hop-instrumental',
    'https://soundcloud.com/unwritten-stories/one-day-creative-commons-free-hip-hop-beat',
    'https://soundcloud.com/uhlmann-roland/cyrron-disco-bloxx-creative-commons-194',
    'https://soundcloud.com/unwritten-stories/flooded-meadows-creative-commons-free-ambient-music',
    'https://soundcloud.com/unwritten-stories/wander-creative-commons-free-trap-beat',
    'https://soundcloud.com/krist-f-horthy/midnightlo-fi-hip-hop-beatfree-creative-commons-license-free-download',
    'https://soundcloud.com/fcm_free_copyright_music/dark-synthwave',
    'https://soundcloud.com/charliewalkrich/charlie-walkrich-ft-chana-thompson-joy-original-mix',
}
INSTRUMENT_QUERIES = ['piano', 'rhodes', 'guitar', 'electric guitar', 'acoustic guitar', 'bass guitar', 'saxophone', 'sax', 'violin',
                      'trumpet', 'organ', 'hammond organ', 'vocals', 'female vocals', 'drums', 'live drums', 'synth', 'analog synth',
                      'instrumental', 'instruments', 'strings and piano', 'jazz', 'funk', 'soul']
GENRE_QUERIES = ['deep house', 'house', 'tech house', 'techno', 'melodic techno', 'trance', 'progressive house', 'drum and bass',
                 'dubstep', 'breakbeat', 'uk garage', 'nu disco', 'disco', 'electro', 'lofi hip hop', 'hip hop beat', 'trip hop',
                 'downtempo', 'chillout', 'ambient', 'synthwave', 'trap', 'edm', 'jazz house', 'afro house', 'acid jazz']

def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json, text/html'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf8', 'replace')
        except Exception as e:  # noqa: BLE001 - network: retry with backoff, then give up on this URL
            err = e
            time.sleep(2 ** (i + 1))
    raise err

def client_id():
    """soundcloud.com's own web client id, read from its JS bundles (the method yt-dlp uses)."""
    page = get('https://soundcloud.com/')
    for src in reversed(re.findall(r'<script[^>]+src="([^"]+\.js)"', page)):
        m = re.search(r'client_id\s*:\s*"([0-9a-zA-Z]{32})"', get(src))
        if m:
            return m.group(1)
    raise RuntimeError('no SoundCloud client id found')

def search(cid, query, pages):
    params = {'q': query, 'limit': 50, 'offset': 0, 'linked_partitioning': 1, 'filter.license': 'to_share', 'client_id': cid}
    url = f'{API}/search/tracks?' + urllib.parse.urlencode(params)
    for page in range(pages):
        try:
            data = json.loads(get(url))
        except Exception as e:  # noqa: BLE001
            if page == 0 and 'filter.license' in params:
                # The license filter only narrows the search; every track's license is checked below anyway.
                del params['filter.license']
                url = f'{API}/search/tracks?' + urllib.parse.urlencode(params)
                try:
                    data = json.loads(get(url))
                except Exception as e2:  # noqa: BLE001
                    print(f'  search "{query}" failed: {str(e2)[:120]}'); return
            else:
                print(f'  search "{query}" stopped: {str(e)[:120]}'); return
        yield from data.get('collection', [])
        nxt = data.get('next_href')
        if not nxt:
            return
        url = nxt + ('&' if '?' in nxt else '?') + 'client_id=' + cid
        time.sleep(1.5)

def fold(uploader):
    return 'train' if int(hashlib.sha256(f'{SEED}|{uploader}'.encode()).hexdigest(), 16) % 10 < 6 else 'held-out'

def cmd_search(manifest_path, max_tracks):
    cid = client_id()
    seen, candidates = set(), []
    for q in INSTRUMENT_QUERIES + GENRE_QUERIES:
        n = 0
        for t in search(cid, q, pages=6):
            url = t.get('permalink_url') or ''
            if t.get('kind') != 'track' or t.get('id') in seen or url in EXCLUDE:
                continue
            seen.add(t.get('id'))
            seconds = (t.get('full_duration') or t.get('duration') or 0) / 1000
            if not str(t.get('license', '')).startswith('cc-') or t.get('policy') not in (None, 'ALLOW') or t.get('streamable') is False:
                continue
            if not 60 <= seconds <= 720:
                continue
            labels, evidence, listing = labels_from_text(track_text(t))
            if not labels:
                continue
            n += 1
            user = (t.get('user') or {})
            candidates.append({'track': t, 'labels': labels, 'evidence': evidence, 'listing': listing, 'seconds': seconds,
                               'uploader': user.get('permalink') or str(user.get('id'))})
        print(f'{q}: {n} new labelled CC tracks ({len(candidates)} total)')
        time.sleep(1.5)
    # Most-informative first (more labelled classes, any absent label), at most 3 per uploader, stable order.
    rng = random.Random(SEED)
    rng.shuffle(candidates)
    candidates.sort(key=lambda c: (-('absent' in c['labels'].values()), -len(c['labels'])))
    per_user, items = {}, []
    for c in candidates:
        if per_user.get(c['uploader'], 0) >= 3:
            continue
        per_user[c['uploader']] = per_user.get(c['uploader'], 0) + 1
        t = c['track']
        start = round(c['seconds'] * EXCERPT_AT)
        items.append({
            'id': f'sc{len(items) + 1:04d}', 'split': 'test', 'fold': fold(c['uploader']), 'source': 'SoundCloud', 'url': t['permalink_url'],
            'title': t.get('title'), 'artist': (t.get('user') or {}).get('username'), 'license': t.get('license'), 'genre': t.get('genre'),
            'sourceTags': t.get('tag_list'), 'description': re.sub(r'\s+', ' ', t.get('description') or '').strip()[:800],
            'groups': {'artist': c['uploader']}, 'listing': c['listing'],
            'reviews': [{'label': k, 'state': v, 'evidence': c['evidence'][k]} for k, v in sorted(c['labels'].items())],
            'excerpt': {'startSeconds': start, 'durationSeconds': EXCERPT_SECONDS, 'trackSeconds': round(c['seconds'])},
        })
        if len(items) >= max_tracks:
            break
    summary = {f: {cls: {s: sum(1 for i in items if i['fold'] == f for r in i['reviews'] if r['label'] == cls and r['state'] == s)
                         for s in ('present', 'absent')} for cls in CLASSES} for f in ('train', 'held-out')}
    out = {'note': 'Frozen SoundCloud set: Creative Commons tracks labelled from their own title/description/tags by '
                   'scripts/soundcloud/labels.py. Audio is fetched at run time and never committed.',
           'seed': SEED, 'clipSeconds': EXCERPT_SECONDS, 'labelCounts': summary, 'items': items}
    with open(manifest_path, 'w') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f'{len(items)} tracks frozen ({sum(i["fold"] == "train" for i in items)} train / {sum(i["fold"] == "held-out" for i in items)} held-out)')
    print(json.dumps(summary))
    if len(items) < 100:
        sys.exit(1)

def cmd_relabel(manifest_path):
    """Re-derive every track's labels from its frozen text with the current labels.py (ids, folds and audio unchanged)."""
    manifest = json.load(open(manifest_path))
    for item in manifest['items']:
        text = track_text({'title': item['title'], 'description': item['description'], 'genre': item['genre'], 'tag_list': item['sourceTags']})
        labels, evidence, listing = labels_from_text(text)
        item['listing'] = listing
        item['reviews'] = [{'label': k, 'state': v, 'evidence': evidence[k]} for k, v in sorted(labels.items())]
    manifest['labelCounts'] = {f: {cls: {s: sum(1 for i in manifest['items'] if i['fold'] == f for r in i['reviews'] if r['label'] == cls and r['state'] == s)
                                          for s in ('present', 'absent')} for cls in CLASSES} for f in ('train', 'held-out')}
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    print(json.dumps(manifest['labelCounts']))

def cmd_fetch(manifest_path, audio_dir, shard='0/1'):
    manifest = json.load(open(manifest_path))
    i, n = map(int, shard.split('/'))
    items = manifest['items'][i::n]
    os.makedirs(audio_dir, exist_ok=True)
    ok = 0
    for item in items:
        out = os.path.join(audio_dir, f"{item['id']}.mp3")
        if os.path.exists(out):
            ok += 1; continue
        tmp = os.path.join(audio_dir, f"{item['id']}.full")
        try:
            subprocess.run(['yt-dlp', '--no-warnings', '--quiet', '--sleep-requests', '1', '-f', 'bestaudio', '-o', tmp + '.%(ext)s', item['url']],
                           check=True, timeout=600)
            full = next(os.path.join(audio_dir, f) for f in os.listdir(audio_dir) if f.startswith(item['id'] + '.full.'))
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(item['excerpt']['startSeconds']), '-t', str(item['excerpt']['durationSeconds']),
                            '-i', full, '-ac', '2', '-ar', '44100', '-b:a', '192k', out], check=True, timeout=300)
            os.remove(full)
            ok += 1
        except Exception as e:  # noqa: BLE001 - a missing track is left out of every count, never scored as a miss
            print(f"{item['id']}: fetch failed: {str(e)[:160]}")
            for f in os.listdir(audio_dir):
                if f.startswith(item['id'] + '.full.'):
                    os.remove(os.path.join(audio_dir, f))
    print(f"{ok}/{len(items)} excerpts ready (shard {shard})")
    if ok < 0.7 * len(items):
        sys.exit(1)

if __name__ == '__main__':
    if sys.argv[1:2] == ['search']:
        cmd_search(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 720)
    elif sys.argv[1:2] == ['relabel']:
        cmd_relabel(sys.argv[2])
    elif sys.argv[1:2] == ['fetch']:
        cmd_fetch(sys.argv[2], sys.argv[3], *sys.argv[4:5])
    else:
        sys.exit(__doc__)
