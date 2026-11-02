"""Effects ("device") augmentation on the stored log-mel windows, for train.py --fx (Nov 2 2026).

Training reads precomputed log-mel windows (value = (ln power + 4.5) / 5, 128 mel bins, 100 frames per second), so
these effects act on the mel itself instead of on audio:
  eq      a smooth random gain curve over the mel bins: a tilt plus one to three bumps or dips, up to +-9 dB each
          (digital silence and padding are left alone).
          A linear filter is a per-frequency power gain, so on log power this is exact up to the mel smearing.
  pitch   shift the whole spectrum up or down by up to 3 mel bins (linear interpolation; roughly +-1 to +-3 semitones
          in the mid range). An approximation: real pitch shift scales frequency, this moves it.
  reverb  add an exponentially decaying tail (RT60 0.2 to 2.0 s, wet -18 to -3 dB) to the power along time, per bin.
  comp    pull each frame's loudness toward the clip's median loudness (ratio 1.5:1 to 4:1, only above the median), the
          way a compressor narrows loud and quiet parts.
  mixstyle  Freq-MixStyle (Schmid et al., DCASE 2022): mix each clip's per-bin mean and spread over time with another
          clip's in the batch, a "different recording device" trick.
Each effect fires with its own probability; --fx sets the base probability (0 = off, the default, so other rounds are
unchanged). Works on CPU or GPU tensors (train.py runs it on the training device). Digital silence stays at or above SILENCE, and every value stays finite.
"""
import math
import numpy as np
import torch

LN10_DB = math.log(10) / 10 / 5      # 1 dB of power gain in stored log-mel units: ln(10 ** (dB / 10)) / 5
SILENCE = -1.4025


def _power(x): return torch.exp(x * 5 - 4.5)
def _logmel(p, floor): return torch.maximum((torch.log(p.clamp(min=1e-10)) + 4.5) / 5, floor)


def eq(x, rng):
    n, bins = x.shape[0], x.shape[1]
    d = x.device; T = lambda a: torch.from_numpy(np.asarray(a, np.float32)).to(d)
    f = torch.linspace(0, 1, bins, device=d)
    curve = T(rng.uniform(-6, 6, n))[:, None] * (f[None] - 0.5)
    k = rng.integers(1, 4, n)                                       # one to three bumps per clip
    c, w, g = T(rng.uniform(0.05, 0.95, (n, 3))), T(rng.uniform(0.03, 0.2, (n, 3))), T(rng.uniform(-9, 9, (n, 3)) * (np.arange(3)[None] < k[:, None]))
    curve = curve + (g[:, :, None] * torch.exp(-0.5 * ((f[None, None] - c[:, :, None]) / w[:, :, None]) ** 2)).sum(1)
    sil = x <= SILENCE + 1e-4                 # padding and digital silence stay silent
    return torch.where(sil, x, (x + (curve * LN10_DB)[:, :, None]).clamp(min=SILENCE))


def pitch(x, rng):
    n, bins, T = x.shape; d = x.device
    s = torch.from_numpy(rng.uniform(-3, 3, (n, 1)).astype(np.float32)).to(d)
    src = torch.arange(bins, dtype=torch.float32, device=d)[None] - s                  # (n, bins): where each bin reads from
    lo = src.floor().clamp(0, bins - 1).long(); hi = (lo + 1).clamp(max=bins - 1); a = (src - src.floor()).clamp(0, 1)
    g = lambda idx: torch.gather(x, 1, idx[:, :, None].expand(n, bins, T))
    v = g(lo) * (1 - a)[:, :, None] + g(hi) * a[:, :, None]
    edge = ((src < 0) | (src > bins - 1))[:, :, None].expand_as(v)
    return torch.where(edge, torch.full_like(v, SILENCE), v)


def reverb(x, rng, frames_per_s=100):
    n, bins, T = x.shape
    p = _power(x)
    L = 2 * T
    d = x.device; rt = torch.from_numpy(rng.uniform(0.2, 2.0, (n, 1)).astype(np.float32)).to(d)
    wet = torch.from_numpy((10 ** (rng.uniform(-18, -3, (n, 1)) / 10)).astype(np.float32)).to(d)
    t = torch.arange(1, T + 1, dtype=torch.float32, device=d)[None] / frames_per_s
    k = wet * torch.pow(10.0, -6 * t / rt)
    tail = torch.fft.irfft(torch.fft.rfft(p, L) * torch.fft.rfft(k, L)[:, None, :], L)[..., :T]
    # the kernel starts one frame late, so the dry frame itself is not doubled
    tail = torch.nn.functional.pad(tail, (1, 0))[..., :T]
    return _logmel(p + tail.clamp(min=0), torch.full_like(x, SILENCE).minimum(x))


def comp(x, rng):
    loud = torch.logsumexp(x * 5, dim=1) / 5                        # per frame loudness, stored units
    med = loud.median(dim=1, keepdim=True).values
    r = torch.from_numpy(rng.uniform(1.5, 4.0, (x.shape[0], 1)).astype(np.float32)).to(x.device)
    over = (loud - med).clamp(min=0)
    cut = over * (1 - 1 / r)
    return torch.maximum(x - cut[:, None, :], torch.full_like(x, SILENCE).minimum(x))


def mixstyle(x, rng, alpha=0.3):
    n = x.shape[0]
    if n < 2: return x
    mu = x.mean(dim=2, keepdim=True); sd = (x.var(dim=2, keepdim=True) + 1e-6).sqrt()
    perm = torch.from_numpy(rng.permutation(n)).to(x.device)
    lam = torch.from_numpy(rng.beta(alpha, alpha, (n, 1, 1)).astype(np.float32)).to(x.device)
    mu2 = lam * mu + (1 - lam) * mu[perm]; sd2 = lam * sd + (1 - lam) * sd[perm]
    return (x - mu) / sd * sd2 + mu2


EFFECTS = [('eq', eq, 1.0), ('pitch', pitch, 0.5), ('reverb', reverb, 0.6), ('comp', comp, 0.5)]


def apply(x, rng, p, mix_p=0.0):
    """x: (batch, bins, frames) float tensor of stored log-mel. Returns a new tensor; each clip gets each effect with
    probability p * weight; then Freq-MixStyle on a mix_p share of the batch."""
    if p <= 0 and mix_p <= 0: return x
    x = x.clone()
    for _, fn, wgt in EFFECTS:
        if p <= 0: break
        sel = np.flatnonzero(rng.random(len(x)) < p * wgt)
        if len(sel): s_ = torch.from_numpy(sel).to(x.device); x[s_] = fn(x[s_], rng)
    if mix_p > 0:
        sel = np.flatnonzero(rng.random(len(x)) < mix_p)
        if len(sel) > 1: s_ = torch.from_numpy(sel).to(x.device); x[s_] = mixstyle(x[s_], rng)
    return torch.nan_to_num(x, nan=SILENCE, posinf=3.0, neginf=SILENCE)
