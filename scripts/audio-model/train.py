"""Fine-tune an AudioSet-pretrained EfficientAT MobileNet as DGE's own instrument tagger.

Usage: python3 scripts/audio-model/train.py <run-dir> --openmic <prep-dir> [--jamendo <prep-dir>] [--soundcloud <prep-dir>]
       [--model mn10_as] [--epochs 8] [--lr 1e-4] [--weak 0.2] [--rare-repeat 1] [--resume] [--absent-fix <json>]

Inputs are the log-mel windows written by prepare.py (OpenMIC-2018 train, benchmark artists removed) and
prepare-jamendo.py (MTG-Jamendo split-0 train/validation, round 3 held-out artists removed) and prepare-soundcloud.py
(the SoundCloud set's train fold; its held-out uploaders are never read here).
Needs a checkout of https://github.com/fschmid56/EfficientAT (MIT) at EFFICIENTAT (default ./EfficientAT).

Recipe follows EfficientAT's ex_openmic.py: BCE over labelled pairs only, log-mel mixup, plus gain, time-roll and
SpecAugment masks; Adam with a one-epoch warm-up then cosine decay. Jamendo's "not tagged by the uploader" absences
are weak, so they count with weight --weak; classes Jamendo has no tag for are never scored there.

About 10% of artists in each source (by hash) are held out as validation. Validation picks the checkpoint and the
per-tag thresholds (calibrate.py); no benchmark clip or artist is ever seen here.
Writes <run-dir>/model.pt (best validation mAP), last.pt (resume state), val.json + val-scores.npy, log.json.
"""
import argparse, hashlib, json, math, os, sys, time, warnings
import numpy as np
warnings.filterwarnings('ignore')
import torch
import torch.nn.functional as F

EAT = os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT'))
sys.path.insert(0, EAT)
_cwd = os.getcwd(); os.chdir(EAT)  # its helpers read metadata/ relative to the checkout at import time
from models.mn.model import get_model  # noqa: E402
os.chdir(_cwd)

CLASSES = ['accordion', 'banjo', 'bass', 'cello', 'clarinet', 'cymbals', 'drums', 'flute', 'guitar', 'mallet_percussion',
           'mandolin', 'organ', 'piano', 'saxophone', 'synthesizer', 'trombone', 'trumpet', 'ukulele', 'violin', 'voice']
# Second head: MTG-Jamendo's 40 instrument tags (prepare-jamendo.py), trained on Jamendo windows only.
JAMENDO_TAGS = ['accordion', 'acousticbassguitar', 'acousticguitar', 'bass', 'beat', 'bell', 'bongo', 'brass', 'cello', 'clarinet', 'classicalguitar',
                'computer', 'doublebass', 'drummachine', 'drums', 'electricguitar', 'electricpiano', 'flute', 'guitar', 'harmonica', 'harp', 'horn',
                'keyboard', 'oboe', 'orchestra', 'organ', 'pad', 'percussion', 'piano', 'pipeorgan', 'rhodes', 'sampler', 'saxophone', 'strings',
                'synthesizer', 'trombone', 'trumpet', 'viola', 'violin', 'voice']
OPENMIC = list(CLASSES)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labelmap import CAT, FREESOUND, FSLD_ROLES, SAME  # noqa: E402
import fsd50k_extra  # noqa: E402
import absent_fix  # noqa: E402
import charts  # noqa: E402
# Third head: the app's own tag names (labelmap.py), taught by FSD50K, NSynth, the effect renders and Freesound, plus the music
# sources' labels below wherever one names the same sound.
CLASSES = OPENMIC + [f'jamendo:{t}' for t in JAMENDO_TAGS] + [f'cat:{l}' for l in CAT] + [f'fsld:{r}' for r in FSLD_ROLES]
from labels_extra import EXTRA_CAT, RUN9_TAGS  # noqa: E402  (run 7: outputs only the uncached sources label)
CLASSES += [f'cat:{l}' for l in EXTRA_CAT if l not in CAT]
ALIAS = {'voice': 'voice', 'piano': 'piano', 'organ': 'organ', 'trumpet': 'trumpet', 'drums': 'drums', 'guitar': 'guitar', 'synthesizer': 'synthesizer',
         'mallet_percussion': 'mallet instrument', 'accordion': 'accordion', 'flute': 'flute', 'cymbals': 'cymbal',
         'jamendo:electricguitar': 'electric guitar', 'jamendo:acousticguitar': 'acoustic guitar', 'jamendo:electricpiano': 'electric piano',
         'jamendo:bell': 'bell', 'jamendo:harp': 'harp', 'jamendo:harmonica': 'harmonica', 'jamendo:percussion': 'percussion', 'jamendo:strings': 'strings'}
SILENCE = -1.4025   # the stored log-mel value of digital silence: (log(1e-5) + 4.5) / 5
WIDTH = {'mn04_as': 0.4, 'mn05_as': 0.5, 'mn10_as': 1.0, 'mn20_as': 2.0, 'mn30_as': 3.0}
FRAMES = 1000

def is_val(artist): return int(hashlib.sha256(f'dge-audio-model|{artist}'.encode()).hexdigest()[:8], 16) % 10 == 0

SOFT = {}   # round 11 (--soft): item id -> {app tag: teacher probability, shifted so the teacher's threshold sits at 0.5}
SOFT_MIX = 0.5   # where the item has a strong label of its own, the target is this share of it plus the rest from the teacher
DROP = set()   # round 13 (--drop): training ids left out entirely (train-side near-duplicates of test clips)
MERGE = {}   # round 12 (--merge): merged-away tag -> the tag it is shown as; a clip with the child present counts the parent present

def load_source(name, mel_path, items, weak):
    if DROP: items = [dict(it, row=it.get('row', i)) for i, it in enumerate(items) if it['id'] not in DROP]   # keep each window's own row
    y = np.zeros((len(items), len(CLASSES)), np.float32); w = np.zeros_like(y); yv = np.zeros_like(y); wv = np.zeros_like(y); col = {c: j for j, c in enumerate(CLASSES)}
    for i, it in enumerate(items):
        weak_set = set(it.get('weakAbsent', []))
        labels = dict(it['labels'])
        if it.get('weakAll') == 'run9':   # run 9 (prepare-run9.py): every run 9 tag the item does not list is a weak absence
            for l in RUN9_TAGS:
                if f'cat:{l}' not in labels: labels[f'cat:{l}'] = 0.0; weak_set.add(f'cat:{l}')
        for c, p in MERGE.items():
            if labels.get(f'cat:{c}', 0) >= 0.5: labels[f'cat:{p}'] = 1.0; weak_set.discard(f'cat:{p}')
        for c, l in ALIAS.items():   # the same sound under the app's name, unless the source labels that name itself
            if c in labels and f'cat:{l}' not in labels: labels[f'cat:{l}'] = labels[c]; weak_set |= {f'cat:{l}'} if c in weak_set else set()
        for c, r in labels.items():
            j = col[c]; y[i, j] = float(r >= 0.5); w[i, j] = weak if c in weak_set else 1.0
        yv[i] = y[i]; wv[i] = w[i]   # validation scores the clip's own labels and weights, never the teacher's soft targets
        for l, p in SOFT.get(it['id'], {}).items():   # distillation: the teacher labels every listed tag, at full weight
            j = col.get(f'cat:{l}')
            if j is None: continue
            y[i, j] = SOFT_MIX * y[i, j] + (1 - SOFT_MIX) * p if w[i, j] >= 1 else p; w[i, j] = 1.0
        for c, (t, wt) in absent_fix.edits(it['id'], labels, weak_set).items():   # --absent-fix: weak absences only, training targets only, after --soft so it wins
            j = col.get(c)
            if j is not None: y[i, j] = t; w[i, j] = wt
    rows = np.array([it.get('row', i) for i, it in enumerate(items)])
    return {'name': name, 'mel': np.load(mel_path, mmap_mode='r'), 'rows': rows, 'y': y, 'yv': yv, 'w': w, 'wv': wv,
            'val': np.array([bool(it['val']) if 'val' in it else is_val(it['artist']) for it in items]), 'ids': [it['id'] for it in items],
            'dj': np.array([bool(it.get('dj')) for it in items])}

def masked_ap(scores, y, w):
    from sklearn.metrics import average_precision_score
    aps = {}
    for j, c in enumerate(CLASSES):
        k = w[:, j] > 0 if c.startswith('jamendo:') or c[4:] in FREESOUND else w[:, j] >= 1   # strong labels only, except tags with no outright absences
        if y[k, j].sum() >= 3 and (1 - y[k, j]).sum() >= 3: aps[c] = float(average_precision_score(y[k, j], scores[k, j]))
    return aps

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run'); ap.add_argument('--openmic'); ap.add_argument('--jamendo'); ap.add_argument('--soundcloud')
    ap.add_argument('--model', default='mn10_as'); ap.add_argument('--epochs', type=int, default=8)
    ap.add_argument('--lr', type=float, default=1e-4); ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--mixup', type=float, default=0.3); ap.add_argument('--weak', type=float, default=0.2)
    ap.add_argument('--dj-repeat', type=int, default=2, help='times each DJ/electronic-genre Jamendo window is seen per epoch')
    ap.add_argument('--rare-repeat', type=int, default=1, help='times each window labelling a --rare-tags instrument as present is seen per epoch')
    ap.add_argument('--rare-tags', default='bass,organ,cello,trumpet,violin,saxophone',
                    help='OpenMIC classes whose positive windows --rare-repeat oversamples (outputs naming the same sound count too)')
    ap.add_argument('--threads', type=int, default=os.cpu_count()); ap.add_argument('--resume', action='store_true')
    ap.add_argument('--limit', type=int, default=0, help='first N clips per source only (smoke test)')
    ap.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    ap.add_argument('--fsd50k'); ap.add_argument('--nsynth'); ap.add_argument('--freesound')
    ap.add_argument('--extra', action='append', default=[], help='<name>=<dir> holding <name>-mel.npy + <name>.json (prepare-extra.py, Slakh)')
    ap.add_argument('--hours', type=float, default=0, help='training time budget: after epoch 1, cut the epoch count (and its cosine schedule) to fit')
    ap.add_argument('--init', help='start from this model.pt (an earlier run); classifier rows are matched by class name')
    ap.add_argument('--repeat', default='', help='name=k,...: times each training window of that source is seen per epoch (e.g. iowa=2,chrisdrive=4)')
    ap.add_argument('--merge', help="round 12: JSON whose 'merge' maps a merged-away tag to the tag it is shown as (round12/round12.json)")
    ap.add_argument('--drop', help='round 13: JSON list of training item ids to leave out')
    ap.add_argument('--soft', help="round 11 teacher soft labels (round11/build-soft.py JSON: {'items': {id: {tag: p}}})")
    ap.add_argument('--absent-fix', help="coverage #2: JSON {'drop': {id: [tag]}, 'add': {id: [tag]}, 'absent': {id: [tag]}} (coverage/labelfix/build-absent-fix.py, coverage/merge-absent.py); "
                    'drop sets a likely-present weak absence to weight 0, add makes it a full-weight positive. Default off')
    args = ap.parse_args()
    if args.merge:
        MERGE.update(json.load(open(args.merge)).get('merge', {})); print(f'merged tags: {MERGE or "none"}', flush=True)
    if args.absent_fix:
        nd, na = absent_fix.load(args.absent_fix); print(f'absent fix: weak absences dropped on {nd} items, positives added on {na} items, sure absences on {len(absent_fix.FIX["absent"])} items', flush=True)
    if args.drop:
        DROP.update(json.load(open(args.drop))); print(f'leaving out {len(DROP)} training ids', flush=True)
    if args.soft:
        SOFT.update(json.load(open(args.soft))['items']); print(f'teacher soft labels for {len(SOFT)} items', flush=True)
    dev = torch.device(args.device)
    torch.set_num_threads(args.threads); torch.manual_seed(0); rng = np.random.default_rng(0)
    os.makedirs(args.run, exist_ok=True)

    sources = []
    if args.openmic:
        sources.append(load_source('openmic', os.path.join(args.openmic, 'train-mel.npy'), json.load(open(os.path.join(args.openmic, 'train.json')))['items'], 1.0))
    if args.jamendo:
        sources.append(load_source('jamendo', os.path.join(args.jamendo, 'jamendo-mel.npy'), json.load(open(os.path.join(args.jamendo, 'jamendo.json')))['items'], args.weak))
    if args.soundcloud:
        sources.append(load_source('soundcloud', os.path.join(args.soundcloud, 'soundcloud-mel.npy'), json.load(open(os.path.join(args.soundcloud, 'soundcloud.json')))['items'], args.weak))
    if args.fsd50k:
        fsd_items = json.load(open(os.path.join(args.fsd50k, 'fsd50k.json')))['items']
        print(f'FSD50K: {fsd50k_extra.relabel(fsd_items, "dev")} labels added from FSD50K classes the prep leaves out (fsd50k_extra.py)', flush=True)
        sources.append(load_source('fsd50k', os.path.join(args.fsd50k, 'fsd50k-mel.npy'), fsd_items, args.weak))
    if args.nsynth:
        sources.append(load_source('nsynth', os.path.join(args.nsynth, 'nsynth-mel.npy'), json.load(open(os.path.join(args.nsynth, 'nsynth.json')))['items'], args.weak))
    if args.freesound:
        sources.append(load_source('freesound', os.path.join(args.freesound, 'freesound-mel.npy'), json.load(open(os.path.join(args.freesound, 'freesound.json')))['items'], args.weak))
    for pair in args.extra:
        name, d = pair.split('=', 1)
        sources.append(load_source(name, os.path.join(d, f'{name}-mel.npy'), json.load(open(os.path.join(d, f'{name}.json')))['items'], args.weak))
    # Each rare OpenMIC class with every output naming the same sound (labelmap.SAME), plus the other basses.
    names = {SAME.get(t, t) for t in args.rare_tags.split(',') if t}
    names |= {'double bass', 'synth bass'} if 'bass guitar' in names else set()
    rare = {c for c in CLASSES if c in args.rare_tags.split(',') or SAME.get(c) in names or c[4:] in names and c.startswith('cat:')}
    rare_cols = np.array(sorted(CLASSES.index(c) for c in rare), int)
    for src in sources: src['rare'] = (src['y'][:, rare_cols] >= 0.5).any(1) if len(rare_cols) else np.zeros(len(src['y']), bool)
    src_repeat = {k: int(v) for k, v in (p.split('=') for p in args.repeat.split(',') if p)}
    pool = [(s, i) for s, src in enumerate(sources) for i in np.flatnonzero(~src['val'])[:args.limit or None]
            for _ in range(max(args.dj_repeat if src['dj'][i] else 1, args.rare_repeat if src['rare'][i] else 1, src_repeat.get(src['name'], 1)))]
    vals = {src['name']: np.flatnonzero(src['val'])[:(args.limit // 8 + 8) if args.limit else None] for src in sources}
    print(f'{len(pool)} train windows per epoch ({sum(int((s["dj"] & ~s["val"]).sum()) for s in sources)} DJ/electronic windows, seen {args.dj_repeat}x; '
          f'{sum(int((s["rare"] & ~s["val"]).sum()) for s in sources)} windows with {sorted(rare)}, seen {args.rare_repeat}x) ' + ', '.join(f'{s["name"]} {int((~s["val"]).sum())}' for s in sources) +
          '; validation ' + ', '.join(f'{k} {len(v)}' for k, v in vals.items()), flush=True)

    model = get_model(width_mult=WIDTH[args.model], pretrained_name=args.model, num_classes=len(CLASSES)).to(dev)
    if args.init and not args.resume:
        old = torch.load(args.init, map_location=dev); old_classes = json.load(open(os.path.join(os.path.dirname(args.init), 'log.json')))['classes']
        new = model.state_dict(); rows = [(CLASSES.index(c), k) for k, c in enumerate(old_classes) if c in CLASSES]
        for key, v in old.items():
            if key in ('classifier.5.weight', 'classifier.5.bias'):
                for j, k in rows: new[key][j] = v[k]
            elif new[key].shape == v.shape: new[key] = v
        model.load_state_dict(new); print(f'started from {args.init} ({len(rows)} of {len(CLASSES)} outputs carried over)', flush=True)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    steps_per_epoch = math.ceil(len(pool) / args.batch); total = steps_per_epoch * args.epochs
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / steps_per_epoch) * 0.5 * (1 + math.cos(math.pi * min(1, s / total))))
    log, best, start = [], -1.0, 0
    if args.resume and os.path.exists(os.path.join(args.run, 'last.pt')):
        st = torch.load(os.path.join(args.run, 'last.pt'), weights_only=False, map_location=dev)
        model.load_state_dict(st['model']); opt.load_state_dict(st['opt']); sched.load_state_dict(st['sched'])
        log, best, start = st['log'], st['best'], st['epoch']; rng = st['rng']
        print(f'resumed after epoch {start}', flush=True)

    def mels(src, idx):
        rows = src['rows'][idx]; order = np.argsort(rows)
        x = np.full((len(rows), 128, FRAMES), SILENCE, np.float32); f = min(FRAMES, src['mel'].shape[2])
        x[order, :, :f] = src['mel'][rows[order]][:, :, :f]           # memmap reads want sorted rows; short clips end in silence
        return torch.from_numpy(x)

    def augment(x):
        x = x + torch.from_numpy((2 * np.log(10 ** (rng.uniform(-6, 6, (len(x), 1, 1)) / 20)) / 5).astype(np.float32))  # gain (mel is (log + 4.5) / 5)
        x = torch.stack([torch.roll(v, int(rng.integers(-50, 50)), dims=-1) for v in x])                         # +-0.5 s
        for v in x:                                                                                                # SpecAugment
            f = int(rng.integers(0, 24)); f0 = int(rng.integers(0, 128 - f)); v[f0:f0 + f] = v.mean()
            t = int(rng.integers(0, 80)); t0 = int(rng.integers(0, FRAMES - t)); v[:, t0:t0 + t] = v.mean()
        return x

    def evaluate():
        model.eval(); out = {}
        with torch.no_grad():
            for src in sources:
                idx = vals[src['name']]; s_out = []
                for s in range(0, len(idx), 64):
                    logits, _ = model(mels(src, idx[s:s + 64]).unsqueeze(1).to(dev)); s_out.append(torch.sigmoid(logits.reshape(-1, len(CLASSES))).cpu().numpy())
                out[src['name']] = np.concatenate(s_out) if s_out else np.zeros((0, len(CLASSES)))
        return out

    charts.start(os.path.basename(os.path.abspath(args.run)), vars(args))
    for epoch in range(start, args.epochs):
        if epoch >= args.epochs: break       # --hours cut the run short
        model.train(); order = rng.permutation(len(pool)); t0 = time.time(); losses = []
        for s in range(0, len(order), args.batch):
            picked = [pool[k] for k in order[s:s + args.batch]]
            xs, ys, ws, part = [], [], [], []
            for si, src in enumerate(sources):
                idx = np.array([i for sj, i in picked if sj == si], int)
                if len(idx): xs.append(mels(src, idx)); ys.append(src['y'][idx]); ws.append(src['w'][idx]); part.append(len(idx))
            x = augment(torch.cat(xs)).unsqueeze(1).to(dev); yt = torch.from_numpy(np.concatenate(ys)).to(dev); wt = torch.from_numpy(np.concatenate(ws)).to(dev)
            if args.mixup:
                # Mix within a source only: sources label different tags, and a pair is scored only where both clips label it.
                starts = np.cumsum([0] + part[:-1]); p2 = torch.from_numpy(np.concatenate([st + rng.permutation(n) for st, n in zip(starts, part)])).to(dev)
                l = rng.beta(args.mixup, args.mixup, len(x))
                lam = torch.from_numpy(np.maximum(l, 1 - l).astype(np.float32)).to(dev)
                x = x * lam.view(-1, 1, 1, 1) + x[p2] * (1 - lam.view(-1, 1, 1, 1))
                yt = yt * lam.view(-1, 1) + yt[p2] * (1 - lam.view(-1, 1))
                wt = wt * (wt[p2] > 0)                                          # score a pair only where both clips label it
            logits, _ = model(x); logits = logits.reshape(-1, len(CLASSES))
            loss = (F.binary_cross_entropy_with_logits(logits, yt, reduction='none') * wt).sum() / wt.sum().clamp(min=1)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step(); losses.append(loss.item())
            if len(losses) % 50 == 0:
                charts.log({'loss': np.mean(losses[-50:]), 'lr': sched.get_last_lr()[0]}, step=epoch * steps_per_epoch + len(losses))
                print(f'epoch {epoch + 1} step {len(losses)}/{steps_per_epoch} loss {np.mean(losses[-50:]):.4f} '
                      f'{(time.time() - t0) / len(losses):.2f}s/step', flush=True)
        scores = evaluate()
        aps = {name: masked_ap(sc, src['yv'][vals[name]], src['wv'][vals[name]]) for (name, sc), src in zip(scores.items(), sources)}
        all_ap = [v for a in aps.values() for v in a.values()]; mAP = float(np.mean(all_ap)) if all_ap else 0.0
        log.append({'epoch': epoch + 1, 'loss': float(np.mean(losses)), 'valMAP': mAP, 'valAP': aps, 'seconds': time.time() - t0})
        print(json.dumps(log[-1]), flush=True)
        charts.log({'epoch': epoch + 1, 'epoch loss': log[-1]['loss'], 'validation mAP': mAP, 'minutes per epoch': log[-1]['seconds'] / 60,
                    **{f'validation mAP {n}': np.mean(list(a.values())) for n, a in aps.items() if a}}, step=(epoch + 1) * steps_per_epoch)
        if epoch == start and args.hours and args.epochs * log[-1]['seconds'] > args.hours * 3600:
            args.epochs = max(epoch + 1, int(args.hours * 3600 // log[-1]['seconds'])); total = steps_per_epoch * args.epochs
            print(f'cut to {args.epochs} epochs to fit {args.hours} h', flush=True)
        if mAP > best:
            best = mAP; torch.save(model.state_dict(), os.path.join(args.run, 'model.pt'))
            for name, sc in scores.items(): np.save(os.path.join(args.run, f'val-{name}.npy'), sc)
        torch.save({'model': model.state_dict(), 'opt': opt.state_dict(), 'sched': sched.state_dict(), 'log': log,
                    'best': best, 'epoch': epoch + 1, 'rng': rng}, os.path.join(args.run, 'last.pt'))
        json.dump({'args': vars(args), 'classes': CLASSES, 'epochs': log,
                   'val': {src['name']: [src['ids'][i] for i in vals[src['name']]] for src in sources}},
                  open(os.path.join(args.run, 'log.json'), 'w'), indent=1)
    charts.finish()

if __name__ == '__main__':
    main()
