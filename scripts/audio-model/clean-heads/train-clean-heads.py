"""Clean retrain of the Mac-trained CLAP detectors, without the Mac and without any judge clip.

The shipped heads in public/sound-model/learned.json came from scripts/train-with-extras.py on Chris's Mac. That run read
`fsd50k-all` (FSD50K dev AND eval) and refit each head on train+test, so their FSD50K eval scores are biased. This job
refits the heads for the FSD50K-mapped sounds from cloud-only data and judges old and clean heads side by side.

Training (cloud only, train side only):
- FSD50K dev CLAP rows (clean-clap/fsd50k-dev-*.npz from fsd50k-clap.py; first 10 s, like the app), labels from FSD50K's
  own public dev.csv through the same class map as scripts/fsd50k-manifest.py. Every listed class is heard, so a dev
  clip without the class is a true negative.
- Round 9 training clips (round11/run9 CLAP features + manifests, split=train), tags as staged. Any clip whose Freesound
  id is an FSD50K eval clip is dropped here from the public eval.csv.
- ALLOW (required): a text file of training ids (one per line) in the private dataset cmjatom/dge-private-train, built
  in the project container by filtering these candidate ids against the private exclude list. Only listed ids train.
  The exclude list itself never leaves the container.
Each head: logistic regression on the L2-normalised 512-d CLAP embedding (class_weight=balanced, as on the Mac). The
threshold is frozen on out-of-fold scores (5 folds by uploader/source group), precision first (Chris, Oct 11): the
lowest cutoff whose precision is at least MIN_PRECISION (default 0.6), so recall is whatever that gives; if none reaches
it, argmax min(P, R). Never below 0.5 (the app ignores lower thresholds).
Each result reports whether it passes the 60/30 ship line and the 50/50, 60/60 and 70/70 counts on FSD50K eval.

Judge: FSD50K eval (public; clip score = max over its whole 10 s windows, as the app-rescore bird check scored it).
Both the shipped head ("old", biased: it trained on these clips) and the clean head are scored.
Writes heads.json (learned.json head format) and report.json to cmjatom/dge-eval-runs under OUT_DIR. Only aggregate
counts go to the training charts.
Env: ALLOW (repo path or local file), OUT_DIR, LOCAL_OUT (write here instead of uploading), LEARNED (URL of the shipped learned.json), TAGS (comma list, default every mapped shipped tag).
"""
import csv, io, json, os, sys, time, urllib.request
import numpy as np
from huggingface_hub import HfApi, HfFileSystem, hf_hub_download
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import charts  # noqa: E402

MAP = {  # FSD50K class -> app label; same as scripts/fsd50k-manifest.py
    'Piano': 'piano', 'Acoustic_guitar': 'acoustic guitar', 'Electric_guitar': 'electric guitar',
    'Bass_guitar': 'bass guitar', 'Organ': 'organ', 'Trumpet': 'trumpet', 'Bowed_string_instrument': 'strings',
    'Marimba_and_xylophone': 'mallet instrument', 'Glockenspiel': 'mallet instrument', 'Harp': 'harp',
    'Harmonica': 'harmonica', 'Accordion': 'accordion', 'Tabla': 'tabla', 'Gong': 'gong', 'Drum_kit': 'drums',
    'Rain': 'rain ambience', 'Raindrop': 'rain ambience', 'Thunderstorm': 'rain ambience',
    'Stream': 'water ambience', 'Waves_and_surf': 'water ambience', 'Ocean': 'water ambience',
    'Trickle_and_dribble': 'water ambience', 'Wind': 'wind ambience', 'Crowd': 'crowd ambience',
    'Cheering': 'crowd ambience', 'Bird_vocalization_and_bird_call_and_bird_song': 'bird ambience',
    'Siren': 'siren', 'Whoosh_and_swoosh_and_swish': 'whoosh', 'Scratching_(performance_technique)': 'vinyl scratch',
    'Bass_drum': 'kick', 'Snare_drum': 'snare', 'Crash_cymbal': 'crash cymbal', 'Finger_snapping': 'finger snap',
    'Cowbell': 'cowbell', 'Tambourine': 'tambourine', 'Whispering': 'whisper', 'Screaming': 'vocal scream',
    'Laughter': 'vocal laugh', 'Gasp': 'vocal gasp'}
FSD, PRIV, EVAL_RUNS = 'Fhrozen/FSD50k', 'cmjatom/dge-private-train', 'cmjatom/dge-eval-runs'
R11 = 'hf://buckets/cmjatom/dge-audio-training/round11/run9'
OUT = os.environ.get('OUT_DIR', 'runs/clean-heads-' + time.strftime('%Y-%m-%d'))
MIN_PRECISION = float(os.environ.get('MIN_PRECISION', 0.6))   # ship line 60/30 (Chris, 1:16 am PDT Oct 11)
BARS = {'60/30': (0.6, 0.3), '50/50': (0.5, 0.5), '60/60': (0.6, 0.6), '70/70': (0.7, 0.7)}
fs, api = HfFileSystem(), HfApi()


def norm(x):
    x = x.astype(np.float32)
    return x / (np.linalg.norm(x, axis=1, keepdims=True) + 1e-8)


def fsd_labels(split):
    path = hf_hub_download(FSD, f'labels/{split}.csv', repo_type='dataset')
    return {int(r['fname']): {MAP[c] for c in r['labels'].split(',') if c in MAP} for r in csv.DictReader(open(path))}


def fsd_npz(split):
    rows = []
    for f in sorted(x for x in api.list_repo_files(PRIV, repo_type='dataset') if x.startswith(f'clean-clap/fsd50k-{split}-')):
        z = np.load(hf_hub_download(PRIV, f, repo_type='dataset'))
        rows.append((z['id'], z['window'], z['clap']))
    return [np.concatenate(c) for c in zip(*rows)]


def main():
    t0 = time.time()
    src = os.environ['ALLOW']
    allow = set(open(src if os.path.exists(src) else hf_hub_download(PRIV, src, repo_type='dataset')).read().split())
    shipped = json.loads(urllib.request.urlopen(os.environ['LEARNED']).read())
    old = {h['label']: h for h in shipped['heads']}
    tags = [t for t in (os.environ.get('TAGS') or ','.join(sorted(set(MAP.values()) & set(old)))).split(',') if t]
    dev_lab, eval_lab = fsd_labels('dev'), fsd_labels('eval')
    info = json.load(open(hf_hub_download(FSD, 'metadata/dev_clips_info_FSD50K.json', repo_type='dataset')))

    # FSD50K dev: one row per clip (first 10 s), group = uploader.
    ids, _, X = fsd_npz('dev')
    keep = np.array([f'fsd50k:{i}' in allow for i in ids])
    ids, X = ids[keep], X[keep]
    LAB = [dev_lab.get(int(i), set()) for i in ids]
    G = [f"fsd50k:{info.get(str(i), {}).get('uploader', i)}" for i in ids]
    STRONG = [True] * len(ids)
    feats = [X]

    # Round 9 training clips (weak tags: an untagged clip is a negative, as in round 11's teacher).
    eval_fs = set(eval_lab)
    n9 = 0
    for m in fs.ls(f'{R11}/manifests', detail=False):
        stem = m.rsplit('/', 1)[-1][:-4]
        part = stem.split('__')[-1]   # feature ids are '<part>/<manifest file>'
        meta = {f"{part}/{r['file']}": r for r in csv.DictReader(io.StringIO(fs.cat(m).decode())) if r['split'] == 'train'}
        for f in sorted(fs.ls(R11, detail=False)):
            if not f.rsplit('/', 1)[-1].startswith(stem + '__') or not f.endswith('.npz'): continue
            z = np.load(io.BytesIO(fs.cat(f)))
            sel = []
            for k, i in enumerate(z['id']):
                r = meta.get(str(i))
                if r is None or r['id'] not in allow: continue
                fsid = r['id'].split(':', 1)[1] if r['id'].startswith('freesound:') else None
                if fsid and fsid.isdigit() and int(fsid) in eval_fs: continue
                sel.append(k); LAB.append(set(filter(None, r['tags'].split('|')))); G.append(r['group'] or r['id'])
                STRONG.append(False)
            if sel: feats.append(z['clap'][sel]); n9 += len(sel)
    X = norm(np.concatenate(feats)); G = np.array(G); STRONG = np.array(STRONG)
    print(f'training rows: {len(LAB)} ({len(LAB) - n9} FSD50K dev, {n9} round 9) in {time.time() - t0:.0f} s', flush=True)

    eids, ewin, EX = fsd_npz('eval')
    EX = norm(EX)
    uniq, inv = np.unique(eids, return_inverse=True)
    charts.start('clean-heads', {'tags': len(tags), 'rows': len(LAB)}, auto=True)

    def judge(w, b, th):
        s = 1 / (1 + np.exp(-(EX @ w + b)))
        clip = np.full(len(uniq), -1.0); np.maximum.at(clip, inv, s)
        return clip >= th

    heads, report = [], []
    for n, tag in enumerate(tags):
        y = np.array([tag in l for l in LAB])
        ey = np.array([tag in eval_lab.get(int(i), set()) for i in uniq])
        row = {'tag': tag, 'trainPositive': int(y.sum()), 'evalPositive': int(ey.sum()), 'evalClips': len(uniq)}
        def pr(pred):
            tp = int((pred & ey).sum())
            return {'precision': round(tp / max(pred.sum(), 1), 3), 'recall': round(tp / max(ey.sum(), 1), 3), 'flagged': int(pred.sum())}
        if tag in old:
            h = old[tag]; row['old'] = {**pr(judge(np.array(h['weights']), h['bias'], h['threshold'])), 'threshold': h['threshold'], 'maybe': bool(h.get('maybe'))}
        if y.sum() < 20:
            row['clean'] = None; row['why'] = 'fewer than 20 clean training clips'; report.append(row); continue
        oof = np.zeros(len(y))
        for tr, te in GroupKFold(5).split(X, y, G):
            if y[tr].sum() == 0: continue
            m = LogisticRegression(C=1.0, class_weight='balanced', max_iter=600, tol=1e-3).fit(X[tr], y[tr])
            oof[te] = m.predict_proba(X[te])[:, 1]
        best, balanced = None, None
        for th in np.unique(np.round(oof[oof >= 0.5], 3)):
            p = oof >= th; tp = (p & y).sum()
            if not tp: continue
            prec, rec = tp / p.sum(), tp / y.sum()
            if best is None and prec >= MIN_PRECISION: best = (min(prec, rec), float(th))   # lowest qualifying cutoff
            if balanced is None or min(prec, rec) >= balanced[0]: balanced = (min(prec, rec), float(th))
        best = best or balanced
        if best is None:
            row['clean'] = None; row['why'] = 'no threshold at or above 0.5'; report.append(row); continue
        m = LogisticRegression(C=1.0, class_weight='balanced', max_iter=600, tol=1e-3).fit(X, y)
        w, b = m.coef_[0], float(m.intercept_[0])
        row['clean'] = {**pr(judge(w, b, best[1])), 'threshold': best[1], 'outOfFoldMinPR': round(best[0], 3)}
        for side in ('old', 'clean'):
            r = row.get(side)
            if r: r['passes'] = {k: r['precision'] >= p_ and r['recall'] >= r_ for k, (p_, r_) in BARS.items()}
        report.append(row)
        heads.append({'group': old.get(tag, {}).get('group', 'source'), 'label': tag, 'weights': [round(float(v), 6) for v in w],
                      'bias': round(b, 6), 'threshold': round(best[1], 4)})
        charts.log({'heads_done': n + 1, 'clean_pass_50': sum(1 for r in report if r.get('clean') and min(r['clean']['precision'], r['clean']['recall']) >= 0.5)}, step=n)
        print(f"{tag:<18} old {row.get('old', {}).get('precision', '-')}/{row.get('old', {}).get('recall', '-')}  "
              f"clean {row['clean']['precision']}/{row['clean']['recall']}  (+{row['evalPositive']} eval, {row['trainPositive']} train)", flush=True)
    charts.finish()
    doc = {'kind': 'clean-heads-v1', 'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'trainRows': len(LAB),
           'fsd50kDevRows': len(LAB) - n9, 'round9Rows': n9, 'evalClips': len(uniq), 'evalWindows': len(eids), 'results': report}
    for name, body in (('report.json', doc), ('heads.json', {'encoder': shipped['encoder'], 'heads': heads})):
        if os.environ.get('LOCAL_OUT'):   # container run: keep results in a local folder, upload nothing
            os.makedirs(os.environ['LOCAL_OUT'], exist_ok=True)
            json.dump(body, open(os.path.join(os.environ['LOCAL_OUT'], name), 'w'), indent=1); continue
        api.upload_file(path_or_fileobj=json.dumps(body, indent=1).encode(), path_in_repo=f'{OUT}/{name}', repo_id=EVAL_RUNS, repo_type='dataset')
    print('done', round(time.time() - t0), 's', flush=True)


if __name__ == '__main__':
    main()
