"""Fetch FSL10K loops (Zenodo 3967852) listed in a manifest, reading single members of the 8.8 GB FSL10K.zip by HTTP range.

Usage: python3 scripts/hf-eval/fetch-fsl10k-loops.py <manifest.json> <audio-out-dir> [shard i/n]
Writes <id>.wav for every item (the zip member unchanged); the app decodes it as it would a user's file.
"""
import io, json, os, sys, time, urllib.request, zipfile

URL = 'https://zenodo.org/api/records/3967852/files/FSL10K.zip/content'


class HttpFile(io.RawIOBase):
    """A read-only seekable file over HTTP ranges (zipfile only reads the central directory and the wanted members)."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'), timeout=60) as r: self.size = int(r.headers['Content-Length'])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n is None or n < 0: n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0: return b''
        for attempt in range(6):
            try:
                req = urllib.request.Request(self.url, headers={'Range': f'bytes={self.pos}-{self.pos + n - 1}'})
                with urllib.request.urlopen(req, timeout=120) as r: data = r.read()
                if len(data) != n: raise IOError(f'{len(data)} of {n} bytes')
                self.pos += n; return data
            except Exception as e:
                print(f'range {self.pos} attempt {attempt + 1}: {e}', flush=True); time.sleep(2 ** attempt)
        raise IOError(f'range {self.pos} failed')
    def readinto(self, b):
        data = self.read(len(b)); b[:len(data)] = data; return len(data)


manifest, out = sys.argv[1:3]
i, n = map(int, (sys.argv[3] if len(sys.argv) > 3 else '0/1').split('/'))
os.makedirs(out, exist_ok=True)
items = json.load(open(manifest))['items'][i::n]
z = zipfile.ZipFile(io.BufferedReader(HttpFile(URL), buffer_size=1 << 20))
names = {n.split('/')[-1]: n for n in z.namelist()}
for k, it in enumerate(items):
    name = it['zip_path'] if it['zip_path'] in z.NameToInfo else names[it['zip_path'].split('/')[-1]]
    open(os.path.join(out, it['id'] + '.wav'), 'wb').write(z.read(name))
    if k % 50 == 0: print(f'{k + 1}/{len(items)} loops', flush=True)
print(f'{len(items)} loops written to {out}')
