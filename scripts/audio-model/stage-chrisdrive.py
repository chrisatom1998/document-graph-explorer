"""Stage Chris's train-half sounds (datasets/chris-drive, split=train only) into a PRIVATE Hugging Face dataset, so the
tagger job (hf-job.sh CHRIS_DATA) can read them without the files ever touching GitHub or a public repo.

Runs as a small CPU Hugging Face job with a token that can write the dataset:
  STAGE_REPO=<user>/dge-private-train MANIFEST=chris-drive/staging.csv MANIFEST_MD5=<md5> OUT=chris-drive/train-v1 \
  python3 stage-chrisdrive.py

MANIFEST (already in the private dataset, uploaded by hand from the shared drive) has one row per train-half audio file:
drive_id, pcm_md5_8 (first 8 hex of the md5 of ffmpeg's s16le decode at the file's own rate and channels), group_hash,
kind, cat_tags. Its md5 must equal MANIFEST_MD5, so a mistyped manifest is refused. Each file is fetched from Chris's
link-shared Google Drive folder by id, its decoded audio checked against pcm_md5_8, and uploaded with a manifest.csv that
adds split=train and source=chris-drive. Only counts are printed; no file names.
"""
import csv, hashlib, io, os, subprocess, sys, tempfile, time, urllib.request
from huggingface_hub import HfApi, hf_hub_download

repo, manifest, out = os.environ['STAGE_REPO'], os.environ['MANIFEST'], os.environ['OUT']
api = HfApi()
data = open(hf_hub_download(repo, manifest, repo_type='dataset'), 'rb').read()
if hashlib.md5(data).hexdigest() != os.environ['MANIFEST_MD5']:
    sys.exit(f'manifest md5 {hashlib.md5(data).hexdigest()} does not match MANIFEST_MD5; refusing')
rows = list(csv.DictReader(io.StringIO(data.decode())))
tmp = tempfile.mkdtemp(); os.makedirs(os.path.join(tmp, 'audio'))
ok, bad = [], []
for k, r in enumerate(rows):
    url = f'https://drive.usercontent.google.com/download?id={r["drive_id"]}&export=download&confirm=t'
    for i in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as resp: blob = resp.read()
            break
        except Exception as e:
            if i == 5: blob = b''; print(f'row {k}: fetch failed ({type(e).__name__})', flush=True)
            time.sleep(5 * (i + 1))
    path = os.path.join(tmp, 'audio', f'{r["drive_id"]}.wav'); open(path, 'wb').write(blob)
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', path, '-f', 's16le', '-'], capture_output=True).stdout
    if blob and hashlib.md5(pcm).hexdigest()[:8] == r['pcm_md5_8']: ok.append(r)
    else: bad.append(k); os.remove(path); print(f'row {k}: audio check failed', flush=True)
    if k % 25 == 0: print(f'{k}/{len(rows)} fetched', flush=True)
with open(os.path.join(tmp, 'manifest.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]) + ['split', 'source']); w.writeheader()
    for r in ok: w.writerow({**r, 'split': 'train', 'source': 'chris-drive'})
info = api.repo_info(repo, repo_type='dataset')
if not info.private: sys.exit('staging repo is not private; refusing to upload')
api.upload_folder(repo_id=repo, repo_type='dataset', folder_path=tmp, path_in_repo=out,
                  commit_message=f'Stage chris-drive train half: {len(ok)} files')
print(f'staged {len(ok)} of {len(rows)} train-half files to {repo}/{out} ({len(bad)} failed: rows {bad})', flush=True)
sys.exit(1 if bad else 0)
