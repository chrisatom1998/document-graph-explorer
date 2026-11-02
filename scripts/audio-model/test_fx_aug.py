"""Checks fx_aug.py keeps the log-mel finite, in range and the right shape, and that each effect does what it says."""
import numpy as np, torch
import fx_aug

def batch(n=6, T=1000):
    g = torch.Generator().manual_seed(0)
    x = torch.rand(n, 128, T, generator=g) * 2 - 0.5
    x[:, :, T // 2:] = fx_aug.SILENCE          # second half silent, like a short clip
    return x

def test_off_is_identity():
    x = batch(); assert torch.equal(fx_aug.apply(x, np.random.default_rng(0), 0.0), x)

def test_all_finite_and_shape():
    x = batch(); y = fx_aug.apply(x, np.random.default_rng(1), 1.0, 1.0)
    assert y.shape == x.shape and torch.isfinite(y).all()

def test_eq_is_a_per_bin_offset():
    x = batch(); x[:, :, :500] += 1.0; y = fx_aug.eq(x, np.random.default_rng(2)); d = (y - x)[:, :, :500]
    assert torch.allclose(d, d[:, :, :1].expand_as(d), atol=1e-5) and d.abs().max() < 35 * fx_aug.LN10_DB
    assert torch.equal(y[:, :, 500:], x[:, :, 500:])      # silence untouched

def test_reverb_fills_the_silence_after_sound():
    x = batch(); y = fx_aug.reverb(x, np.random.default_rng(3))
    assert (y[:, :, 500:520] > x[:, :, 500:520] + 1e-4).any() and (y >= x - 1e-4).all()

def test_comp_only_turns_loud_frames_down():
    x = batch(); y = fx_aug.comp(x, np.random.default_rng(4)); assert (y <= x + 1e-6).all()

def test_pitch_moves_a_peak():
    x = torch.full((1, 128, 10), fx_aug.SILENCE); x[0, 60] = 1.0
    y = fx_aug.pitch(x, np.random.default_rng(5)); assert int(y[0, :, 0].argmax()) != 60 or y[0, 60, 0] < 1.0

if __name__ == '__main__':
    for k, f in list(globals().items()):
        if k.startswith('test_'): f(); print('ok', k)
