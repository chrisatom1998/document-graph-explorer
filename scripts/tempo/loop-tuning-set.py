"""Tuning loops for the loop tempo path: FSL10K annotated loops chosen like the 330 judge loops, but never a judge loop.
Drum loops never come from a judge-set uploader; melodic loops may (the judge set took nearly all the others) and are marked.
Writes <out>/tuning.json and fetches the tuning and judge wavs into <out>/audio (judge set: the loops thread's
fsl10k-loops-tempo-330.json, in the project files).
Usage: python3 scripts/tempo/loop-tuning-set.py <annotations.zip> <judge fsl10k-loops-tempo-330.json> <out dir>"""
import io, json, os, sys, re, zipfile, collections, random, importlib.util
ANN, JUDGE, OUT = sys.argv[1:4]
spec = importlib.util.spec_from_file_location('f', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'hf-eval', 'fetch-fsl10k-loops.py'))
src = open(spec.origin).read().split('manifest, out = sys.argv')[0]; ns = {}; exec(src, ns)
z = zipfile.ZipFile(io.BufferedReader(ns['HttpFile'](ns['URL']), buffer_size=1 << 20))
names = {n.split('/')[-1].split('_')[0]: n for n in z.namelist() if n.startswith('audio/wav/')}
meta = json.loads(z.read('metadata.json'))
judge = json.load(open(JUDGE))
jids = {str(i['sound_id']) for i in judge['items']} | {str(i['sound_id']) for i in judge['no_defined_tempo']}
jup = {i['uploader'] for i in judge['items']} | {i['uploader'] for i in judge['no_defined_tempo']}
a = zipfile.ZipFile(ANN); per = collections.defaultdict(list)
for n in a.namelist():
    m = re.search(r'sound-(\d+)\.json', n)
    if m: per[m.group(1)].append(json.loads(a.read(n)))
items, notempo = [], []
for sid, anns in per.items():
    if sid in jids or sid not in meta or sid not in names: continue
    up = meta[sid].get('username')
    if all(d.get('defined_tempo') is False for d in anns) and not any(d.get('discard') for d in anns):
        notempo.append({'sound_id': int(sid), 'zip_path': names[sid], 'uploader': up, 'judge_uploader': up in jup}); continue
    if any(d.get('discard') or not d.get('well_cut') or d.get('defined_tempo') is False or d.get('signature') != '4/4' for d in anns): continue
    try: bpms = {float(d['bpm']) for d in anns}
    except Exception: continue
    if len(bpms) != 1: continue
    b = bpms.pop()
    if not 50 <= b <= 200: continue
    ins = [d.get('instrumentation', {}) for d in anns]
    if any(i != ins[0] for i in ins): continue
    i = ins[0]
    g = 'drums' if i.get('percussion') else 'melodic' if (i.get('melody') or i.get('chords')) and not i.get('vocal') else None
    # Melodic loops come almost only from judge-set uploaders (the judge set took the rest), so those are allowed for
    # melodic and marked; drum loops never come from a judge-set uploader.
    if g == 'drums' and up in jup: continue
    if g: items.append({'sound_id': int(sid), 'zip_path': names[sid], 'uploader': up, 'listener_bpm': b, 'group': g, 'annotators': len(anns), 'judge_uploader': up in jup})
random.seed(11); random.shuffle(items)
cap = collections.Counter(); keep = []
for it in items:
    if cap[it['uploader']] < 4: cap[it['uploader']] += 1; keep.append(it)
random.shuffle(notempo)
print(len(items), 'eligible;', len(keep), 'kept', collections.Counter(i['group'] for i in keep), 'uploaders', len(cap), 'no-tempo', len(notempo))
json.dump({'about': 'FSL10K tuning loops for the loop tempo path: judge selection rules, no judge loop, drum loops never by a judge-set uploader (melodic ones may be, marked judge_uploader), max 4 per uploader, seed 11', 'items': keep, 'no_defined_tempo': notempo}, open(f'{OUT}/tuning.json', 'w'))
os.makedirs(f'{OUT}/audio', exist_ok=True)
allit = keep + notempo + judge['items'] + judge['no_defined_tempo']
for k, it in enumerate(allit):
    p = f"{OUT}/audio/{it['sound_id']}.wav"
    if not os.path.exists(p):
        open(p + '.part', 'wb').write(z.read(it['zip_path'] if it['zip_path'] in z.NameToInfo else names[str(it['sound_id'])]))
        os.replace(p + '.part', p)
    if k % 100 == 0: print(k, len(allit), flush=True)
print('done')
