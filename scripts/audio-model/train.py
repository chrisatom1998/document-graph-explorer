"""Fine-tune an AudioSet-pretrained EfficientAT MobileNet as DGE's own instrument tagger.

Usage: python3 scripts/audio-model/train.py <run-dir> --openmic <prep-dir> [--jamendo <prep-dir>] [--soundcloud <prep-dir>]
       [--model mn10_as] [--epochs 8] [--lr 1e-4] [--weak 0.2] [--resume]

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
CLASSES = OPENMIC + [f'jamendo:{t}' for t in JAMENDO_TAGS]
WIDTH = {'mn04_as': 0.4, 'mn05_as': 0.5, 'mn10_as': 1.0, 'mn20_as': 2.0, 'mn30_as': 3.0}
FRAMES = 1000

def is_val(artist): return int(hashlib.sha256(f'dge-audio-model|{artist}'.encode()).hexdigest()[:8], 16) % 10 == 0

def load_source(name, mel_path, items, weak):
    y = np.zeros((len(items), len(CLASSES)), np.float32); w = np.zeros_like(y)
    for i, it in enumerate(items):
        weak_set = set(it.get('weakAbsent', []))
        for c, r in it['labels'].items():
            j = CLASSES.index(c); y[i, j] = float(r >= 0.5); w[i, j] = weak if c in weak_set else 1.0
    rows = np.array([it.get('row', i) for i, it in enumerate(items)])
    return {'name': name, 'mel': np.load(mel_path, mmap_mode='r'), 'rows': rows, 'y': y, 'w': w,
            'val': np.array([is_val(it['artist']) for it in items]), 'ids': [it['id'] for it in items],
            'dj': np.array([bool(it.get('dj')) for it in items])}

def masked_ap(scores, y, w):
    from sklearn.metrics import average_precision_score
    aps = {}
    for j, c in enumerate(CLASSES):
        k = w[:, j] > 0 if c.startswith('jamendo:') else w[:, j] >= 1   # strong labels only, except Jamendo's own tags
        if y[k, j].sum() >= 3 and (1 - y[k, j]).sum() >= 3: aps[c] = float(average_precision_score(y[k, j], scores[k, j]))
    return aps

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run'); ap.add_argument('--openmic', required=True); ap.add_argument('--jamendo'); ap.add_argument('--soundcloud')
    ap.add_argument('--model', default='mn10_as'); ap.add_argument('--epochs', type=int, default=8)
    ap.add_argument('--lr', type=float, default=1e-4); ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--mixup', type=float, default=0.3); ap.add_argument('--weak', type=float, default=0.2)
    ap.add_argument('--dj-repeat', type=int, default=2, help='times each DJ/electronic-genre Jamendo window is seen per epoch')
    ap.add_argument('--threads', type=int, default=os.cpu_count()); ap.add_argument('--resume', action='store_true')
    ap.add_argument('--limit', type=int, default=0, help='first N clips per source only (smoke test)')
    ap.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    args = ap.parse_args()
    dev = torch.device(args.device)
    torch.set_num_threads(args.threads); torch.manual_seed(0); rng = np.random.default_rng(0)
    os.makedirs(args.run, exist_ok=True)

    sources = [load_source('openmic', os.path.join(args.openmic, 'train-mel.npy'), json.load(open(os.path.join(args.openmic, 'train.json')))['items'], 1.0)]
    if args.jamendo:
        sources.append(load_source('jamendo', os.path.join(args.jamendo, 'jamendo-mel.npy'), json.load(open(os.path.join(args.jamendo, 'jamendo.json')))['items'], args.weak))
    if args.soundcloud:
        sources.append(load_source('soundcloud', os.path.join(args.soundcloud, 'soundcloud-mel.npy'), json.load(open(os.path.join(args.soundcloud, 'soundcloud.json')))['items'], args.weak))
    pool = [(s, i) for s, src in enumerate(sources) for i in np.flatnonzero(~src['val'])[:args.limit or None]
            for _ in range(args.dj_repeat if src['dj'][i] else 1)]
    vals = {src['name']: np.flatnonzero(src['val'])[:(args.limit // 8 + 8) if args.limit else None] for src in sources}
    print(f'{len(pool)} train windows per epoch ({sum(int((s["dj"] & ~s["val"]).sum()) for s in sources)} DJ/electronic windows, seen {args.dj_repeat}x) ' + ', '.join(f'{s["name"]} {int((~s["val"]).sum())}' for s in sources) +
          '; validation ' + ', '.join(f'{k} {len(v)}' for k, v in vals.items()), flush=True)

    model = get_model(width_mult=WIDTH[args.model], pretrained_name=args.model, num_classes=len(CLASSES)).to(dev)
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
        x = np.empty((len(rows), 128, FRAMES), np.float32)
        x[order] = src['mel'][rows[order]][:, :, :FRAMES]              # memmap reads want sorted rows
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

    for epoch in range(start, args.epochs):
        model.train(); order = rng.permutation(len(pool)); t0 = time.time(); losses = []
        for s in range(0, len(order), args.batch):
            picked = [pool[k] for k in order[s:s + args.batch]]
            xs, ys, ws = [], [], []
            for si, src in enumerate(sources):
                idx = np.array([i for sj, i in picked if sj == si], int)
                if len(idx): xs.append(mels(src, idx)); ys.append(src['y'][idx]); ws.append(src['w'][idx])
            x = augment(torch.cat(xs)).unsqueeze(1).to(dev); yt = torch.from_numpy(np.concatenate(ys)).to(dev); wt = torch.from_numpy(np.concatenate(ws)).to(dev)
            if args.mixup:
                p2 = torch.randperm(len(x), device=dev); l = rng.beta(args.mixup, args.mixup, len(x))
                lam = torch.from_numpy(np.maximum(l, 1 - l).astype(np.float32)).to(dev)
                x = x * lam.view(-1, 1, 1, 1) + x[p2] * (1 - lam.view(-1, 1, 1, 1))
                yt = yt * lam.view(-1, 1) + yt[p2] * (1 - lam.view(-1, 1))
                wt = wt * (wt[p2] > 0)                                          # score a pair only where both clips label it
            logits, _ = model(x); logits = logits.reshape(-1, len(CLASSES))
            loss = (F.binary_cross_entropy_with_logits(logits, yt, reduction='none') * wt).sum() / wt.sum().clamp(min=1)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step(); losses.append(loss.item())
            if len(losses) % 50 == 0:
                print(f'epoch {epoch + 1} step {len(losses)}/{steps_per_epoch} loss {np.mean(losses[-50:]):.4f} '
                      f'{(time.time() - t0) / len(losses):.2f}s/step', flush=True)
        scores = evaluate()
        aps = {name: masked_ap(sc, src['y'][vals[name]], src['w'][vals[name]]) for (name, sc), src in zip(scores.items(), sources)}
        mAP = float(np.mean([v for a in aps.values() for v in a.values()]))
        log.append({'epoch': epoch + 1, 'loss': float(np.mean(losses)), 'valMAP': mAP, 'valAP': aps, 'seconds': time.time() - t0})
        print(json.dumps(log[-1]), flush=True)
        if mAP > best:
            best = mAP; torch.save(model.state_dict(), os.path.join(args.run, 'model.pt'))
            for name, sc in scores.items(): np.save(os.path.join(args.run, f'val-{name}.npy'), sc)
        torch.save({'model': model.state_dict(), 'opt': opt.state_dict(), 'sched': sched.state_dict(), 'log': log,
                    'best': best, 'epoch': epoch + 1, 'rng': rng}, os.path.join(args.run, 'last.pt'))
        json.dump({'args': vars(args), 'classes': CLASSES, 'epochs': log,
                   'val': {src['name']: [src['ids'][i] for i in vals[src['name']]] for src in sources}},
                  open(os.path.join(args.run, 'log.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
