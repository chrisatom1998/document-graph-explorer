"""Export DGE's trained instrument tagger to ONNX for onnxruntime-web, with its log-mel front end inside the graph.

Usage: python3 scripts/audio-model/export.py <run-dir>/model.pt <out-dir> [--model mn10_as]

Input `samples32k` float32 [batch, 320000] (10 s of 32 kHz mono in [-1, 1]); output `scores` float32 [batch, 20], the
sigmoid probability of each OpenMIC class in train.py's CLASSES order. The STFT is a fixed convolution (window x DFT),
so the graph uses only Conv, Mul, Add, MatMul, Log and pooling ops that every onnxruntime backend runs. Checks the ONNX
output against PyTorch's own front end + model on random and real-looking audio before writing.
Writes <out-dir>/model.onnx and model.json (classes, sha256, input contract).
"""
import argparse, hashlib, json, os, sys, warnings
import numpy as np
warnings.filterwarnings('ignore')
import torch
import torch.nn as nn

EAT = os.path.abspath(os.environ.get('EFFICIENTAT', 'EfficientAT'))
sys.path.insert(0, EAT)
_cwd = os.getcwd(); os.chdir(EAT)
from models.mn.model import get_model  # noqa: E402
from models.preprocess import AugmentMelSTFT  # noqa: E402
import torchaudio  # noqa: E402
os.chdir(_cwd)
sys.path.insert(0, os.path.dirname(__file__))
from train import CLASSES, WIDTH, FRAMES  # noqa: E402

N_FFT, WIN, HOP, SR, MELS = 1024, 800, 320, 32000, 128

class FrontEnd(nn.Module):
    """AugmentMelSTFT in eval mode, as ONNX-friendly ops: pre-emphasis, centred reflect-padded STFT as a strided
    convolution with window-weighted cosine/sine kernels, power, kaldi mel banks (fmin 0, fmax 15 kHz), log, scaling."""
    def __init__(self):
        super().__init__()
        window = torch.zeros(N_FFT); off = (N_FFT - WIN) // 2
        window[off:off + WIN] = torch.hann_window(WIN, periodic=False)          # torch.stft centres a short window
        n = torch.arange(N_FFT, dtype=torch.float64); k = torch.arange(N_FFT // 2 + 1, dtype=torch.float64)[:, None]
        ang = 2 * np.pi * k * n / N_FFT
        self.register_buffer('real', (torch.cos(ang) * window).float()[:, None, :])
        self.register_buffer('imag', (-torch.sin(ang) * window).float()[:, None, :])
        banks, _ = torchaudio.compliance.kaldi.get_mel_banks(MELS, N_FFT, SR, 0.0, SR // 2 - 1000, vtln_low=100.0, vtln_high=-500., vtln_warp_factor=1.0)
        self.register_buffer('mel', nn.functional.pad(banks, (0, 1)).float())
    def forward(self, x):
        x = x[:, 1:] - 0.97 * x[:, :-1]                                          # pre-emphasis (conv1d [-0.97, 1])
        x = nn.functional.pad(x.unsqueeze(1), (N_FFT // 2, N_FFT // 2), mode='reflect')
        re = nn.functional.conv1d(x, self.real, stride=HOP); im = nn.functional.conv1d(x, self.imag, stride=HOP)
        power = re * re + im * im                                                # [B, 513, T]
        m = torch.matmul(self.mel, power)
        return ((m + 1e-5).log() + 4.5) / 5.

class Tagger(nn.Module):
    def __init__(self, net):
        super().__init__(); self.front = FrontEnd(); self.net = net
    def forward(self, samples32k):
        mel = self.front(samples32k)[:, :, :FRAMES].unsqueeze(1)
        logits, _ = self.net(mel)
        return torch.sigmoid(logits.reshape(-1, len(CLASSES)))        # the net squeezes away a batch of one

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('weights'); ap.add_argument('out'); ap.add_argument('--model', default='mn10_as')
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True)
    net = get_model(width_mult=WIDTH[args.model], pretrained_name=None, num_classes=len(CLASSES))
    net.load_state_dict(torch.load(args.weights, map_location='cpu')); net.eval()
    tagger = Tagger(net).eval()
    ref = AugmentMelSTFT(n_mels=MELS, sr=SR, win_length=WIN, hopsize=HOP, n_fft=N_FFT, freqm=0, timem=0, fmin=0, fmax=None).eval()
    g = torch.Generator().manual_seed(0)
    t = torch.arange(320000) / SR
    probe = torch.stack([0.1 * torch.randn(320000, generator=g),
                         0.3 * torch.sin(2 * np.pi * 220 * t) * (torch.sin(2 * np.pi * 2 * t) > 0) + 0.02 * torch.randn(320000, generator=g)])
    with torch.no_grad():
        mel_ref = ref(probe)[:, :, :FRAMES]; mel_ours = tagger.front(probe)[:, :, :FRAMES]
        assert torch.allclose(mel_ref, mel_ours, atol=2e-3), f'front end differs by {(mel_ref - mel_ours).abs().max()}'
        want = torch.sigmoid(net(mel_ref.unsqueeze(1))[0]).numpy()
    path = os.path.join(args.out, 'model.onnx')
    torch.onnx.export(tagger, probe, path, input_names=['samples32k'], output_names=['scores'], opset_version=17,
                      dynamic_axes={'samples32k': {0: 'batch'}, 'scores': {0: 'batch'}}, dynamo=False)
    import onnxruntime as ort
    got = ort.InferenceSession(path, providers=['CPUExecutionProvider']).run(None, {'samples32k': probe.numpy()})[0]
    assert got.shape == want.shape and ort.InferenceSession(path, providers=['CPUExecutionProvider']).run(None, {'samples32k': probe[:1].numpy()})[0].shape == (1, len(CLASSES))
    err = float(np.abs(got - want).max()); assert err < 1e-3, f'ONNX differs from PyTorch by {err}'
    data = open(path, 'rb').read()
    json.dump({'classes': CLASSES, 'input': {'name': 'samples32k', 'sampleRate': SR, 'samples': 320000, 'channels': 1},
               'output': {'name': 'scores', 'activation': 'sigmoid'}, 'base': f'EfficientAT {args.model} (AudioSet), MIT',
               'sha256': {'model.onnx': hashlib.sha256(data).hexdigest()}, 'bytes': len(data), 'maxAbsErrorVsPyTorch': err},
              open(os.path.join(args.out, 'model.json'), 'w'), indent=1)
    print(f'wrote {path} ({len(data) / 1e6:.1f} MB), max |ONNX - PyTorch| = {err:.2e}')

if __name__ == '__main__':
    main()
