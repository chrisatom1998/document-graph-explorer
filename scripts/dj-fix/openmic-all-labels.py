"""Write OpenMIC's aggregated labels for every instrument (not only the 11 the frozen manifests keep) for given clips.

Usage: python3 scripts/dj-fix/openmic-all-labels.py <openmic-2018-v1.0.0.tgz> <out.json> <manifest.json>...
Relevance >= 0.5 is present, lower is absent, a missing pair is unknown (as in scripts/mixed-music/build.py).
"""
import csv, io, json, sys, tarfile
tgz, out, manifests = sys.argv[1], sys.argv[2], sys.argv[3:]
tf = tarfile.open(tgz)
member = next(m for m in tf.getmembers() if m.isfile() and m.name.endswith('openmic-2018-aggregated-labels.csv') and '/._' not in m.name)
labels = {}
for r in csv.DictReader(io.StringIO(tf.extractfile(member).read().decode('utf-8-sig'))):
    labels.setdefault(r['sample_key'], {})[r['instrument']] = 'present' if float(r['relevance']) >= 0.5 else 'absent'
res = {}
for path in manifests:
    for it in json.load(open(path))['items']:
        res[it['id']] = labels.get(it['sampleKey'], {})
json.dump(res, open(out, 'w'), indent=0, sort_keys=True)
print(len(res), 'clips')
