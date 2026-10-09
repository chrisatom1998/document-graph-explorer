"""Fetch the MedleyDB and MoisesDB mixes for the whole-song judge set and save each as <out>/<shard>/<opaque id>.mp3.

Usage: python3 scripts/whole-songs/fetch-audio.py <manifest.json> <archive url with {set}> <out dir> <shards> [keep]
Each archive (7.6 GB and 8.7 GB of WAVs) is downloaded whole with resume, read once, and deleted before the next.
Song k of the manifest (sorted by id) goes to shard k % shards. With [keep], only that shard's songs are saved (one HF
Jobs part). Fails if any song it should save is missing afterwards.
"""
import json, os, subprocess, sys, tarfile

def main():
    manifest, url, out, shards = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
    keep = int(sys.argv[5]) if len(sys.argv) > 5 else None
    items = sorted(json.load(open(manifest))['items'], key=lambda i: i['id'])
    where = {i['archivePath']: (k % shards, i['id']) for k, i in enumerate(items) if keep is None or k % shards == keep}
    items = [i for i in items if i['archivePath'] in where]
    for s in range(shards): os.makedirs(os.path.join(out, str(s)), exist_ok=True)
    for name in ('medleydb', 'moisesdb'):
        tgz = f'{name}.tar.gz'
        subprocess.run(['curl', '-fL', '--retry', '8', '--retry-all-errors', '-C', '-', '-sS', '-o', tgz, url.replace('{set}', name)], check=True)
        with tarfile.open(tgz, 'r:gz') as t:
            for m in t:
                if not m.isfile() or m.name not in where: continue
                shard, oid = where[m.name]
                subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', 'pipe:0', '-b:a', '192k', os.path.join(out, str(shard), f'{oid}.mp3')],
                               input=t.extractfile(m).read(), check=True)
        os.remove(tgz)
        print(name, 'done', flush=True)
    missing = [i['id'] for i in items if not os.path.exists(os.path.join(out, str(where[i['archivePath']][0]), f"{i['id']}.mp3"))]
    if missing: raise SystemExit(f'{len(missing)} songs missing, e.g. {missing[:3]}')
    print(len(items), 'songs saved')

if __name__ == '__main__':
    main()
