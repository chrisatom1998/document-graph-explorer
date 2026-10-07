"""Train the "sounds alike" projection on top of an audio embedding (CLAP today; any fixed-size vector works).

Usage: python3 scripts/sound-alike/train.py <tracks.json> <embeddings dir or .jsonl ...> --out <dir>
       [--dim 128] [--hidden 0] [--temperature .3] [--objective contrastive] [--max-mix .75] [--library 150] [--draws 300]

<tracks.json> comes from select-jamendo.py; embeddings are embed-clap.mjs JSON lines with ids "<track>@<start>". The
input size is read from the vectors, so other embeddings (e.g. MERT) can be trained the same way.

Model: P(x) = unit(W2 act(W1 x + b1) + b2) (or unit(W x + b) with --hidden 0) on the unit mean of a track's windows.
Loss: a soft supervised-contrastive loss: in each batch every track should rank the others by how many genre, mood and
instrument tags they share (Jaccard, weighted genre .5, mood .25, instrument .25). The app compares
v = [sqrt(1 - mix) * unit(x), sqrt(mix) * P(x)], so cosine(v) = (1 - mix) * raw cosine + mix * projected cosine, which
keeps the raw fingerprint's say on sounds Jamendo never covers (e.g. single notes).

Selection uses validation tracks only (split-0 validation, no artist shared with training): random libraries of
--library genre-tagged tracks, linked by the app's rule (each track's `neighbors` closest at cosine >= `floor`). The
shipped (mix, neighbors, floor) has the highest same-genre link rate among those that make at least as many links as
today's rule (raw CLAP, 3 closest, 0.7) does on the same libraries, both for one 10 s window per track (as the
benchmark clips are) and for whole-track means (as longer files are). Writes <out>/sound-projection.json (int8 weights,
the layout src/audio/soundProjection.ts reads) and <out>/report.json.
"""
import argparse, base64, glob, json, math, os, time
import numpy as np
import torch

ap = argparse.ArgumentParser()
ap.add_argument('tracks'); ap.add_argument('embeddings', nargs='+'); ap.add_argument('--out', required=True)
ap.add_argument('--dim', type=int, default=128); ap.add_argument('--hidden', type=int, default=0)
ap.add_argument('--epochs', type=int, default=60); ap.add_argument('--batch', type=int, default=1024)
ap.add_argument('--temperature', type=float, default=.3); ap.add_argument('--lr', type=float, default=1e-3)
ap.add_argument('--library', type=int, default=150); ap.add_argument('--draws', type=int, default=300)
ap.add_argument('--seed', type=int, default=0)
ap.add_argument('--objective', choices=['contrastive', 'tags', 'both'], default='contrastive',
                help='contrastive: soft supervised-contrastive; tags: predict the tags from the projection (multi-label); both: sum')
ap.add_argument('--max-mix', type=float, default=.75,
                help='largest learned share allowed; keeping some raw fingerprint protects sounds Jamendo lacks (one-shots, single notes)')
ap.add_argument('--weights', default='genre=.5,mood=.25,instrument=.25', help='tag-group weights in the relevance target')
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
rng = np.random.default_rng(args.seed); torch.manual_seed(args.seed)
unit = lambda m: m / np.maximum(np.linalg.norm(m, axis=-1, keepdims=True), 1e-8)

# --- data --------------------------------------------------------------------------------------------------------
tracks = {t['track']: t for t in json.load(open(args.tracks))['tracks']}
windows = {}
files = [f for e in args.embeddings for f in (sorted(glob.glob(os.path.join(e, '**', '*.jsonl'), recursive=True)) if os.path.isdir(e) else [e])]
for f in files:
    for line in open(f):
        if not line.strip(): continue
        r = json.loads(line); track = r['id'].split('@')[0]
        if track in tracks: windows.setdefault(track, {})[r['id']] = r['embedding']
ids = sorted(windows)
D = len(next(iter(windows[ids[0]].values())))
W = max(len(w) for w in windows.values())
X = np.zeros((len(ids), W, D), np.float32); M = np.zeros((len(ids), W), bool)
for i, t in enumerate(ids):
    for k, v in enumerate(windows[t].values()): X[i, k] = v; M[i, k] = True
mean_vec = unit((X * M[..., None]).sum(1) / M.sum(1, keepdims=True)).astype(np.float32)  # the app: mean of window vectors, then unit length
split = np.array([tracks[t]['split'] for t in ids])
vocab = {g: sorted({x for t in ids for x in tracks[t][g]}) for g in ('genre', 'mood', 'instrument')}
def multi_hot(g):
    index = {x: j for j, x in enumerate(vocab[g])}; m = np.zeros((len(ids), len(index)), np.float32)
    for i, t in enumerate(ids):
        for x in tracks[t][g]: m[i, index[x]] = 1
    return m
tags = {g: multi_hot(g) for g in vocab}
TAG_WEIGHT = {k: float(v) for k, v in (kv.split('=') for kv in args.weights.split(','))}
tr, va = np.where(split == 'train')[0], np.where(split == 'validation')[0]
assert not ({tracks[ids[i]]['artist'] for i in tr} & {tracks[ids[i]]['artist'] for i in va}), 'an artist is in both train and validation'
print(f'{len(ids)} tracks embedded ({len(tr)} train, {len(va)} validation), {D}-d input, up to {W} windows; '
      f'{len(vocab["genre"])} genres, {len(vocab["mood"])} moods, {len(vocab["instrument"])} instruments', flush=True)

def relevance(idx):
    """Weighted Jaccard tag overlap between every pair in idx (torch, [B, B])."""
    total = 0
    for g, w in TAG_WEIGHT.items():
        m = torch.from_numpy(tags[g][idx]); inter = m @ m.T; size = m.sum(1)
        union = size[:, None] + size[None, :] - inter
        total = total + w * torch.where(union > 0, inter / union.clamp(min=1), torch.zeros_like(inter))
    return total

# --- model -------------------------------------------------------------------------------------------------------
class Projection(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.net = torch.nn.Linear(D, args.dim) if not args.hidden else torch.nn.Sequential(
            torch.nn.Linear(D, args.hidden), torch.nn.GELU(approximate='tanh'), torch.nn.Linear(args.hidden, args.dim))
        self.head = torch.nn.Linear(args.dim, len(TAG_COLUMNS))  # training only (--objective tags/both)
    def forward(self, x): return torch.nn.functional.normalize(self.net(x), dim=-1)

# Tags seen on at least 20 training tracks, for the tag objective; each group's loss is scaled by its weight.
TAG_COLUMNS = [(g, j) for g in TAG_WEIGHT for j in np.where(tags[g][tr].sum(0) >= 20)[0]]
TAG_TARGET = np.stack([tags[g][:, j] for g, j in TAG_COLUMNS], 1)
TAG_SCALE = torch.tensor([TAG_WEIGHT[g] / sum(1 for h, _ in TAG_COLUMNS if h == g) for g, _ in TAG_COLUMNS]) * len(TAG_WEIGHT)
def tag_loss(x, idx):
    logits = model.head(model.net(x))
    bce = torch.nn.functional.binary_cross_entropy_with_logits(logits, torch.from_numpy(TAG_TARGET[idx]), reduction='none')
    return (bce * TAG_SCALE).sum(1).mean()
def objective(x, idx):
    loss = 0
    if args.objective != 'tags': loss = loss + soft_supcon(model(x), relevance(idx))
    if args.objective != 'contrastive': loss = loss + tag_loss(x, idx)
    return loss

model = Projection()
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
steps_per_epoch = math.ceil(len(tr) / args.batch)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * steps_per_epoch)

def augmented(idx):
    """Unit mean of a random non-empty subset of each track's windows (one window up to all)."""
    keep = M[idx] & (rng.random(M[idx].shape) < rng.uniform(.3, 1, (len(idx), 1)))
    empty = ~keep.any(1)
    keep[empty, M[idx][empty].argmax(1)] = True
    return torch.from_numpy(unit((X[idx] * keep[..., None]).sum(1) / keep.sum(1, keepdims=True)).astype(np.float32))

def soft_supcon(z, rel):
    logits = z @ z.T / args.temperature
    eye = torch.eye(len(z), dtype=torch.bool)
    logits = logits.masked_fill(eye, -1e9); rel = rel.masked_fill(eye, 0)
    has = rel.sum(1) > 0
    target = rel[has] / rel[has].sum(1, keepdim=True)
    return -(target * torch.log_softmax(logits[has], 1)).sum(1).mean()

def project(vectors):
    with torch.no_grad(): return model(torch.from_numpy(vectors)).numpy()

def val_loss():
    order = rng.permutation(va)[:4096]; losses = []
    with torch.no_grad():
        for b in range(0, len(order), args.batch):
            idx = order[b:b + args.batch]
            if len(idx) > 1: losses.append(float(objective(torch.from_numpy(mean_vec[idx]), idx)))
    return float(np.mean(losses))

t0 = time.time(); best, best_state, history = 1e9, None, []
for epoch in range(args.epochs):
    model.train(); order = rng.permutation(tr); total = 0
    for b in range(0, len(order), args.batch):
        idx = order[b:b + args.batch]
        loss = objective(augmented(idx), idx)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); total += float(loss.detach()) * len(idx)
    model.eval(); vl = val_loss(); history.append({'epoch': epoch + 1, 'train': total / len(tr), 'validation': vl})
    if vl < best: best, best_state = vl, {k: v.clone() for k, v in model.state_dict().items()}
    if epoch % 5 == 4 or epoch == args.epochs - 1: print(f'epoch {epoch + 1}: train {total / len(tr):.4f}, validation {vl:.4f} ({time.time() - t0:.0f}s)', flush=True)
model.load_state_dict(best_state); model.eval()

# --- int8 export (what the app runs) -----------------------------------------------------------------------------
layers = [model.net] if not args.hidden else [model.net[0], model.net[2]]
exported, quantized = [], []
for layer in layers:
    w = layer.weight.detach().numpy().astype(np.float64); b = layer.bias.detach().numpy().astype(np.float64)
    scale = np.maximum(np.abs(w).max(1), 1e-12) / 127
    q = np.clip(np.round(w / scale[:, None]), -127, 127).astype(np.int8)
    exported.append({'rows': int(w.shape[0]), 'cols': int(w.shape[1]), 'weights': base64.b64encode(q.tobytes()).decode(),
                     'scale': [float(f'{s:.6g}') for s in scale], 'bias': [float(f'{x:.6g}') for x in b]})
    quantized.append((q.astype(np.float32) * np.array(exported[-1]['scale'], np.float32)[:, None], np.array(exported[-1]['bias'], np.float32)))
def project_q(x):
    h = x @ quantized[0][0].T + quantized[0][1]
    if args.hidden: h = torch.nn.functional.gelu(torch.from_numpy(h), approximate='tanh').numpy() @ quantized[1][0].T + quantized[1][1]
    return unit(h)

# --- policy on validation libraries ------------------------------------------------------------------------------
MIXES = [0, .25, .5, .75, 1]
NEIGHBORS = [1, 2, 3, 4]  # the app keeps at most 4 links of one kind per track
FLOORS = np.round(np.arange(.2, .975, .025), 3)
pool = va[tags['genre'][va].sum(1) > 0]
libraries = [rng.choice(pool, args.library, replace=False) for _ in range(args.draws)]
def shares(g, a, b): return (tags[g][a] * tags[g][b]).sum(1) > 0
def links(sim, k, floor):
    """The app's rule: each track's k closest are candidates; a pair links at cosine >= floor."""
    n = len(sim); s = sim.copy(); np.fill_diagonal(s, -np.inf)
    top = np.argsort(-s, 1)[:, :k]
    pairs = {(min(i, j), max(i, j)) for i in range(n) for j in top[i] if s[i, j] >= floor}
    return np.array(sorted(pairs), int).reshape(-1, 2)
def grid(raw_v):
    proj_v, rows = project_q(raw_v), []
    for mix in MIXES:
        stats = {(k, f): np.zeros(5) for k in NEIGHBORS for f in FLOORS}  # links, genre, mood, instrument, linked tracks
        for lib in libraries:
            sim = (1 - mix) * raw_v[lib] @ raw_v[lib].T + mix * proj_v[lib] @ proj_v[lib].T
            for k in NEIGHBORS:
                base = links(sim, k, -2)
                for f in FLOORS:
                    p = base[sim[base[:, 0], base[:, 1]] >= f] if len(base) else base
                    if not len(p): continue
                    a, b = lib[p[:, 0]], lib[p[:, 1]]
                    stats[(k, f)] += [len(p), shares('genre', a, b).sum(), shares('mood', a, b).sum(), shares('instrument', a, b).sum(), len(np.unique(p))]
        for (k, f), st in stats.items():
            n = max(st[0], 1)
            rows.append({'mix': mix, 'neighbors': k, 'floor': float(f), 'links': st[0] / args.draws, 'sameGenre': st[1] / n, 'sameMood': st[2] / n,
                         'sameInstrument': st[3] / n, 'linkedTracks': st[4] / args.draws / args.library})
    return rows
# The benchmark and many uploads are single 10 s clips, while longer files store a mean over windows (cosines run
# higher), so the policy is scored on both: one window per track (the middle one) and the whole-track mean.
middle = unit(X[np.arange(len(ids)), np.minimum(M.sum(1) - 1, 1)]).astype(np.float32)
rows, mean_rows = grid(middle), grid(mean_vec)
find = lambda table, r: next(x for x in table if x['mix'] == r['mix'] and x['neighbors'] == r['neighbors'] and abs(x['floor'] - r['floor']) < 1e-9)
current = find(rows, {'mix': 0, 'neighbors': 3, 'floor': .7}); current_mean = find(mean_rows, current)
# At least today's link count on both inputs; then the best same-genre rate averaged over the two.
eligible = [r for r in rows if r['mix'] <= args.max_mix and r['links'] >= current['links'] and find(mean_rows, r)['links'] >= current_mean['links']]
score = lambda r: (round((r['sameGenre'] + find(mean_rows, r)['sameGenre']) / 2, 4), r['links'])
chosen = max(eligible, key=score)
raw_best = max((r for r in eligible if r['mix'] == 0), key=score)
pct = lambda x: f'{100 * x:.1f}%'
show = lambda name, r: print(f'{name}: mix {r["mix"]}, {r["neighbors"]} closest, floor {r["floor"]}: {r["links"]:.1f} links per {args.library} tracks, '
                             f'{pct(r["linkedTracks"])} linked, same genre {pct(r["sameGenre"])}, mood {pct(r["sameMood"])}, instrument {pct(r["sameInstrument"])}')
print(f'\nValidation libraries: {args.draws} x {args.library} genre-tagged tracks (random pair shares a genre '
      f'{pct(np.mean([shares("genre", *rng.choice(pool, (2, 2000), replace=True)).mean()]))})')
print('One 10 s window per track:')
show('  today (raw CLAP)', current); show('  best raw-CLAP policy', raw_best); show('  chosen', chosen)
print('Whole-track mean of windows, same policies:')
show('  today (raw CLAP)', find(mean_rows, current)); show('  best raw-CLAP policy', find(mean_rows, raw_best)); show('  chosen', find(mean_rows, chosen))

projection = {'version': 1, 'inputDim': D, 'outputDim': args.dim, 'activation': 'gelu' if args.hidden else None,
              'mix': chosen['mix'], 'neighbors': chosen['neighbors'], 'floor': chosen['floor'], 'layers': exported,
              'trainedOn': f'MTG-Jamendo split-0 train ({len(tr)} tracks); policy chosen on split-0 validation ({len(va)} tracks, no shared artist)'}
json.dump(projection, open(os.path.join(args.out, 'sound-projection.json'), 'w'), separators=(',', ':'))
json.dump({'args': vars(args), 'tracks': {'train': len(tr), 'validation': len(va)}, 'inputDim': D, 'history': history,
           'current': current, 'bestRaw': raw_best, 'chosen': chosen, 'grid': rows, 'meanGrid': mean_rows}, open(os.path.join(args.out, 'report.json'), 'w'), indent=1)
print(f'wrote {args.out}/sound-projection.json ({os.path.getsize(os.path.join(args.out, "sound-projection.json")) / 1024:.0f} KB)')
