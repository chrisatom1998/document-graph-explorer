"""Fetch real remix groups from ccMixter for the versions test set.

Each group is several remixes of one a cappella ("pell"), made by different
producers: different recordings of the same song. Only remixes whose single
listed source is that a cappella are kept, so groups never overlap.
Usage: fetch-ccmixter-remixes.py <out_dir> [per_group]
Writes <out_dir>/remixes.json and the mp3s (CC licensed; license per file in the manifest).
"""
import json, os, re, subprocess, sys, time

API = 'https://ccmixter.org/api/query?f=json&'
# A cappellas with many remixes. Six Brad Sucks songs share one singer, so
# cross-group pairs are hard negatives for any voice- or genre-level model.
PELLS = [1288, 1289, 1290, 1299, 1301, 66, 65, 67, 930, 1491]

def get(url, tries=4, referer=None):
    for attempt in range(tries):
        try:
            # curl, not urllib: some ccMixter responses carry a header line over urllib's 64 KB limit.
            # Audio downloads are hotlink-protected: they need a browser agent and the file page as referer.
            extra = ['-A', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', '-e', referer] if referer else []
            return subprocess.run(['curl', '-sSfL', '-m', '300', *extra, url], check=True, capture_output=True).stdout
        except Exception as e:  # noqa: BLE001
            if attempt == tries - 1: raise
            time.sleep(2 ** (attempt + 1))

def seconds(ps):
    m = re.match(r'^(?:(\d+):)?(\d+):(\d+)$', ps or '')
    if not m: return 0
    h, mi, s = m.groups()
    return int(h or 0) * 3600 + int(mi) * 60 + int(s)

def main():
    out = sys.argv[1]; per = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    os.makedirs(out, exist_ok=True)
    groups = []
    for pell in PELLS:
        meta = json.loads(get(f'{API}ids={pell}'))[0]
        remixes = json.loads(get(f'{API}remixes={pell}&limit=60'))
        kept = []
        for u in remixes:
            if len(kept) >= per: break
            mp3 = next((f for f in u['files'] if f['file_name'].lower().endswith('.mp3')), None)
            if not mp3 or not 90 <= seconds(mp3['file_format_info'].get('ps')) <= 420: continue
            sources = json.loads(get(f'{API}sources={u["upload_id"]}&limit=10'))
            if [s['upload_id'] for s in sources] != [pell]: continue
            path = os.path.join(out, f'{u["upload_id"]}.mp3')
            if not os.path.exists(path):
                try: data = get(mp3['download_url'], referer=u['file_page_url'])
                except Exception: continue  # some listed files are gone (404)
                with open(path, 'wb') as f: f.write(data)
            kept.append({'id': f'ccm-{u["upload_id"]}', 'path': path, 'file': mp3['file_name'], 'title': u['upload_name'],
                         'artist': u['user_name'], 'license': u.get('license_url'), 'page': u['file_page_url']})
            print(f'  {pell} {meta["upload_name"][:30]}: {u["upload_name"][:50]}', flush=True)
        if len(kept) >= 3:
            groups.append({'source': pell, 'song': meta['upload_name'], 'singer': meta['user_name'], 'remixes': kept})
    json.dump({'groups': groups}, open(os.path.join(out, 'remixes.json'), 'w'), indent=1)
    print(f'{len(groups)} groups, {sum(len(g["remixes"]) for g in groups)} remixes')

main()
