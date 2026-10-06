"""AllConv-style key CNN (Korzeniowski & Widmer 2018) on 120 quarter-tone bins at 5 fps.
Usage: train_key.py cv|final <labels.json> <out-dir>"""
import json, sys, os, random, hashlib, numpy as np, torch, torch.nn as nn, torch.nn.functional as Fn
torch.set_num_threads(4); torch.manual_seed(0); random.seed(0); np.random.seed(0)
mode, labels, out = sys.argv[1:4]; os.makedirs(out, exist_ok=True)
rows = json.load(open(labels))['key']
X = {r['f']: np.load(r['f'])['key'].astype(np.float32) for r in rows}
MU = np.mean([x.mean() for x in X.values()]); SD = np.mean([x.std() for x in X.values()])
T = int(os.environ.get('T', 50)); EPOCHS = int(os.environ.get('EPOCHS', 60))

class Net(nn.Module):
    def __init__(s, ch=8, dense=48):
        super().__init__()
        L = []; c = 1
        for i in range(5): L += [nn.Conv2d(c, ch, 5, padding=2), nn.BatchNorm2d(ch), nn.ELU()]; c = ch
        s.conv = nn.Sequential(*L)
        s.freq = nn.Conv2d(ch, dense, (1, 120)); s.bn = nn.BatchNorm2d(dense)
        s.out = nn.Linear(dense, 24); s.drop = nn.Dropout(0.3)
    def forward(s, x):                       # x: (B, T, 120)
        h = s.conv(((x - MU) / SD).unsqueeze(1))
        h = Fn.elu(s.bn(s.freq(h))).squeeze(3).mean(2)
        return s.out(s.drop(h))

def sample(r, shift, t=T):
    x = X[r['f']]
    if r.get('loop') and len(x) < t: x = np.tile(x, (t // max(1, len(x)) + 1, 1))   # loops repeat, so tile instead of padding
    if len(x) > t: o = random.randrange(len(x) - t); x = x[o:o + t]
    else: x = np.pad(x, ((0, t - len(x)), (0, 0)))
    x = x[:, 12 + 2 * shift: 132 + 2 * shift]
    y = ((r['tonic'] - shift) % 12) + 12 * r['minor']
    return x, y

def train(tr):
    net = Net(); opt = torch.optim.Adam(net.parameters(), 1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    for ep in range(EPOCHS):
        net.train(); random.shuffle(tr)
        for i in range(0, len(tr), 32):
            b = tr[i:i + 32]; xs, ys = zip(*[sample(r, random.randint(-6, 5)) for r in b])
            w = torch.tensor([r['w'] for r in b])
            loss = (Fn.cross_entropy(net(torch.tensor(np.stack(xs))), torch.tensor(ys), reduction='none', label_smoothing=0.05) * w).mean()
            opt.zero_grad(); loss.backward(); opt.step()
        sched.step()
    return net

@torch.no_grad()
def predict(net, x, t=None):
    net.eval(); x = x[:, 12:132]
    return net(torch.tensor(x[None])).softmax(1)[0].numpy()

def mirex(p, tt, tm):
    pt, pm = p % 12, p // 12
    if pt == tt and pm == tm: return 1, 1
    if pm == tm and (pt - tt) % 12 in (5, 7): return 0, .5
    if pm != tm and ((tm == 0 and pt == (tt + 9) % 12) or (tm == 1 and pt == (tt + 3) % 12)): return 0, .3
    if pt == tt: return 0, .2
    return 0, 0

if mode == 'cv':
    fold = lambda g: int(hashlib.sha256(g.encode()).hexdigest()[:8], 16) % 5
    res = []
    for k in range(5):
        tr = [r for r in rows if fold(r['group']) != k]; te = [r for r in rows if fold(r['group']) == k]
        net = train(tr)
        for r in te:
            x = X[r['f']]
            for cut, seg in [('whole', x), ('mid10', x[max(0, len(x)//2 - 25): len(x)//2 + 25])]:
                p = int(predict(net, seg).argmax()); e, m = mirex(p, r['tonic'], r['minor'])
                res.append({'src': r['src'], 'cut': cut, 'exact': e, 'mirex': m})
        print('fold', k, 'done', flush=True)
    for src in ('mtg', 'gtzan'):
        for cut in ('whole', 'mid10'):
            s = [x for x in res if x['src'] == src and x['cut'] == cut]
            print(f"{src} {cut}: exact {np.mean([x['exact'] for x in s]):.3f} mirex {np.mean([x['mirex'] for x in s]):.3f} n={len(s)}")
    json.dump(res, open(f'{out}/cv.json', 'w'))
else:
    net = train(list(rows)); torch.save({'state': net.state_dict(), 'mu': float(MU), 'sd': float(SD)}, f'{out}/key-cnn.pt')
    print('saved')
