"""Round 12 guard: stop the job if any training row is an FSD50K eval clip (the scoreboard judges on FSD50K eval).

Usage: python3 scripts/audio-model/round12/check-fsd50k-eval.py <manifest.csv or folder of them>...
  Reads public metadata only (Fhrozen/FSD50k labels/eval.csv). A row counts when its keep column is 1 (or absent) and its
  split is train; its Freesound id comes from an id like freesound:<n> or a freesound.org/.../sounds/<n>/ URL.
Checked on 2026-10-10 in the project container: 0 hits in run9/v1-audit (41,216 Freesound ids) and empty-tags/v1 (696).
"""
import csv, glob, os, re, sys
from huggingface_hub import hf_hub_download

ID = re.compile(r'freesound:(\d+)'); URL = re.compile(r'freesound\.org/people/[^/]+/sounds/(\d+)')

def main():
    ev = {r['fname'] for r in csv.DictReader(open(hf_hub_download('Fhrozen/FSD50k', 'labels/eval.csv', repo_type='dataset')))}
    files = [f for a in sys.argv[1:] for f in (glob.glob(os.path.join(a, '**', '*.csv'), recursive=True) if os.path.isdir(a) else [a])]
    seen, hits = 0, []
    for f in files:
        for r in csv.DictReader(open(f)):
            if r.get('keep', '1') != '1' or r.get('split', 'train') != 'train': continue
            for n in set(ID.findall(r.get('id', ''))) | set(URL.findall(r.get('url', ''))):
                seen += 1
                if n in ev: hits.append(r.get('id'))
    print(f'FSD50K eval check: {seen} Freesound ids in {len(files)} lists, {len(hits)} in FSD50K eval', flush=True)
    if hits: print('stopping: training rows that are FSD50K eval clips: ' + ', '.join(sorted(hits)[:20]), flush=True); sys.exit(1)

if __name__ == '__main__':
    main()
