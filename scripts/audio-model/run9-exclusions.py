"""Freesound ids that other public sets re-host, so run 9 never stages them from Freesound (a re-host in a held-out
split would leak, and one in training would count twice). Reads only public metadata, never audio.

Usage: python3 -I scripts/audio-model/run9-exclusions.py <out.json>
  esc50        ESC-50 meta/esc50.csv src_file (karolpiczak/ESC-50 @ master)
  us8k         UrbanSound8K fsID (HF parquet danavery/urbansound8K, metadata columns only, by range reads)
  nonspeech7k  Nonspeech7k file names whose source is freesound.org (HF parquet W4ng1204/Nonspeech7k, metadata only)
Not covered: MUSAN's free-sound noise files carry no Freesound id (renamed noise-free-sound-NNNN, LICENSE says only
'Public Domain on Free Sound'), so they can only be matched by audio; Good-sounds re-uploads are matched by their
'good-sounds' Freesound tag in run9-select.py.
"""
import csv, io, json, re, sys, urllib.request
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem

def cols(fs, files, names):
    out = {n: [] for n in names}
    for f in files:
        t = pq.ParquetFile(fs.open(f, block_size=1 << 20)).read(columns=names)
        for n in names: out[n] += t.column(n).to_pylist()
    return out

def main():
    fs = HfFileSystem(); ex = {}
    raw = urllib.request.urlopen('https://raw.githubusercontent.com/karolpiczak/ESC-50/master/meta/esc50.csv', timeout=60).read().decode()
    ex['esc50'] = sorted({int(r['src_file']) for r in csv.DictReader(io.StringIO(raw)) if r['src_file'].isdigit()})
    us = [f for f in fs.find('datasets/danavery/urbansound8K@refs%2Fconvert%2Fparquet') if f.endswith('.parquet')]
    ex['us8k'] = sorted({int(x) for x in cols(fs, us, ['fsID'])['fsID']})
    ns = cols(fs, ['datasets/W4ng1204/Nonspeech7k/train.parquet', 'datasets/W4ng1204/Nonspeech7k/test.parquet'], ['filename', 'source'])
    ex['nonspeech7k'] = sorted({int(m.group(1)) for f, s in zip(ns['filename'], ns['source']) if 'freesound' in (s or '') for m in [re.match(r'(\d+)', f)] if m})
    json.dump(ex, open(sys.argv[1], 'w'))
    print(', '.join(f'{k} {len(v)}' for k, v in ex.items()))

if __name__ == '__main__':
    main()
