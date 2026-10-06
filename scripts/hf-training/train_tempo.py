"""Tempo classifier (after Schreiber & Mueller 2018): 40 mel x 215 frames (10 s) -> 256 classes, 30..285 BPM.
Usage: train_tempo.py cv|final <labels.json> <out-dir>"""
import json, sys, os, random, hashlib, numpy as np, torch, torch.nn as nn, torch.nn.functional as Fn
DEV = 'cuda' if torch.cuda.is_available() else 'cpu'
torch.manual_seed(0); random.seed(0); np.random.seed(0)
mode, labels, out = sys.argv[1:4]; os.makedirs(out, exist_ok=True)
rows = [r for r in json.load(open(labels))['tempo'] if 30 <= r['bpm'] <= 285]
X = {r['f']: np.load(r['f'])['tempo'].astype(np.float32) for r in rows}
MU = float(np.mean([x.mean() for x in X.values()])); SD = float(np.mean([x.std() for x in X.values()]))
T = 215; EPOCHS = int(os.environ.get('EPOCHS', 40)); PER = int(os.environ.get('PER', 6))

class MF(nn.Module):        # multi-filter module: parallel long temporal filters
    def __init__(s, cin, k=(16, 32, 64, 96, 128, 192), f=12, cout=36):
        super().__init__()
        s.pool = nn.AvgPool2d((5, 1)); s.bn = nn.BatchNorm2d(cin)
        s.convs = nn.ModuleList([nn.Conv2d(cin, f, (1, kk), padding=(0, kk // 2)) for kk in k])
        s.mix = nn.Conv2d(f * len(k), cout, 1)
    def forward(s, x):
        x = s.bn(s.pool(x)); T = x.shape[3]
        return Fn.elu(s.mix(torch.cat([Fn.elu(c(x))[..., :T] for c in s.convs], 1)))

class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.front = nn.Sequential(*[m for i in range(3) for m in (nn.Conv2d(1 if i == 0 else 16, 16, (1, 5), padding=(0, 2)), nn.BatchNorm2d(16), nn.ELU())])
        s.mf1 = MF(16); s.mf2 = MF(36)                     # 40 mel -> 8 -> 1 (pool 5 each)
        s.head = nn.Sequential(nn.BatchNorm1d(36), nn.Dropout(0.5), nn.Linear(36, 64), nn.ELU(), nn.Linear(64, 256))
    def forward(s, x):                                    # x: (B, T, 40)
        h = ((x - MU) / SD).transpose(1, 2).unsqueeze(1)  # (B,1,40,T)
        h = s.mf2(s.mf1(s.front(h)))                      # (B,36,1,T)
        return s.head(h.mean((2, 3)))

def stretch(x, r):          # r>1 = slower (more frames); tempo becomes bpm/r
    n = int(round(len(x) * r)); idx = np.linspace(0, len(x) - 1, n)
    lo = np.floor(idx).astype(int); hi = np.minimum(lo + 1, len(x) - 1); w = (idx - lo)[:, None]
    return x[lo] * (1 - w) + x[hi] * w

def sample(r, aug=True):
    x = X[r['f']]; bpm = r['bpm']
    if r.get('loop') and len(x) < 2 * T: x = np.tile(x, (2 * T // max(1, len(x)) + 1, 1))   # loops repeat: tile, don't pad
    if aug:
        rr = float(np.exp(np.random.uniform(np.log(0.8), np.log(1.25))))
        if 30 <= bpm / rr <= 285:
            seg = min(len(x), int(T / rr) + 2); o = random.randrange(max(1, len(x) - seg)); x = stretch(x[o:o + seg], rr); bpm = bpm / rr
    if len(x) > T: o = random.randrange(len(x) - T); x = x[o:o + T]
    else: x = np.pad(x, ((0, T - len(x)), (0, 0)))
    return x, bpm

def target(bpm):            # Gaussian over neighbouring classes
    c = np.arange(256) + 30; t = np.exp(-0.5 * ((c - bpm) / 1.0) ** 2); return t / t.sum()

class DS(torch.utils.data.Dataset):
    def __init__(s, items): s.items = items
    def __len__(s): return len(s.items)
    def __getitem__(s, i):
        np.random.seed((torch.initial_seed() + i) % 2**32); random.seed(torch.initial_seed() + i)
        x, b = sample(s.items[i]); return torch.tensor(x, dtype=torch.float32), torch.tensor(target(b), dtype=torch.float32)

def train(tr):
    net = Net().to(DEV); opt = torch.optim.Adam(net.parameters(), 1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    for ep in range(EPOCHS):
        net.train()
        dl = torch.utils.data.DataLoader(DS(tr * PER), batch_size=32, shuffle=True, num_workers=int(os.environ.get('WORKERS', 6)), drop_last=True)
        for xb, tb in dl:
            logp = net(xb.to(DEV)).log_softmax(1)
            loss = -(tb.to(DEV) * logp).sum(1).mean()
            opt.zero_grad(); loss.backward(); opt.step()
        sched.step()
    return net

@torch.no_grad()
def predict(net, x, tile=False):        # average over 10 s windows (hop 5 s); tile=True repeats a short loop instead of padding
    net.eval()
    if tile and 0 < len(x) < T: x = np.tile(x, (T // len(x) + 1, 1))[:T]
    if len(x) < T: x = np.pad(x, ((0, T - len(x)), (0, 0)))
    wins = [x[o:o + T] for o in range(0, len(x) - T + 1, 107)]
    p = net(torch.tensor(np.stack(wins), dtype=torch.float32).to(DEV)).softmax(1).mean(0).cpu().numpy()
    return 30 + int(p.argmax()), p

ok = lambda e, t: abs(e - t) <= 0.04 * t
if mode == 'cv':
    fold = lambda g: int(hashlib.sha256(g.encode()).hexdigest()[:8], 16) % 5
    res = []
    for k in range(5):
        tr = [r for r in rows if fold(r['group']) != k]; te = [r for r in rows if fold(r['group']) == k]
        net = train(tr)
        for r in te:
            x = X[r['f']]
            for cut, seg in [('whole', x), ('mid10', x[max(0, len(x)//2 - 107): max(0, len(x)//2 - 107) + T])]:
                e, _ = predict(net, seg)
                res.append({'src': r['src'], 'cut': cut, 'ok': ok(e, r['bpm']), 'oct': any(ok(e * f, r['bpm']) for f in (1, 2, .5, 3, 1/3)), 'est': e, 'bpm': r['bpm']})
        print('fold', k, 'done', flush=True)
        net.cpu(); torch.save({'state': net.state_dict(), 'mu': MU, 'sd': SD}, f'{out}/fold{k}.pt')
    for src in ('gst', 'mtg', 'gtzan'):
        for cut in ('whole', 'mid10'):
            s = [x for x in res if x['src'] == src and x['cut'] == cut]
            print(f"{src} {cut}: within4 {np.mean([x['ok'] for x in s]):.3f} octave-ok {np.mean([x['oct'] for x in s]):.3f} n={len(s)}")
    json.dump(res, open(f'{out}/cv.json', 'w'))
else:
    net = train(list(rows)); net.cpu(); torch.save({'state': net.state_dict(), 'mu': MU, 'sd': SD}, f'{out}/tempo-cnn.pt'); print('saved')
