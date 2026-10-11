"""Desktop Dasheng add-on: Dasheng-0.6B plus the big-teacher Dasheng heads as one browser ONNX graph.

python3 export-dasheng.py <teach-das dir (teacher.pt, thresholds.json)> <out dir> [--int8]

The graph takes 16 kHz mono audio (1 x samples, any length from 0.25 s to 10 s) and returns every teacher tag's
probability, exactly as the teacher saw its training clips (big-teacher/features.py): the Dasheng log-mel front end,
the encoder, last-layer mean and max plus the block-16 mean (3,840 numbers), the stored z-score, then the mean of the
five fold heads' sigmoids. The mel front end is written as a fixed DFT so the graph needs no STFT operator.

Writes model.onnx and model.json (classes, sha256, input). --int8 also writes the dynamically quantized model the app
downloads, and checks it against the float graph and the PyTorch pipeline on a few synthetic clips.
"""
import argparse, hashlib, json, math, os

import numpy as np
import torch
import torch.nn as nn

DAS = "mispeech/dasheng-0.6B"
DAS_MID = 15  # 0-based block index: output of block 16 of 32, as features.py hooks it
SR, N_FFT, HOP, N_MELS, F_MAX, TOP_DB = 16000, 512, 160, 64, 8000.0, 120.0


class Head(nn.Module):  # round11/fit-teacher.py
    def __init__(self, d, k, h=768):
        super().__init__()
        self.norm = nn.LayerNorm(d)
        self.net = nn.Sequential(nn.Dropout(0.2), nn.Linear(d, h), nn.GELU(), nn.Dropout(0.3), nn.Linear(h, k))

    def forward(self, x):
        return self.net(self.norm(x))


class LogMel(nn.Module):
    """torchaudio MelSpectrogram(16 kHz, n_fft 512, hop 160, 64 HTK mels to 8 kHz, power 2, centred reflect pad)
    and AmplitudeToDB(top_db=120), as DashengFeatureExtractor builds them, from conv1d DFT kernels."""

    def __init__(self):
        super().__init__()
        import torchaudio.functional as AF

        n = torch.arange(N_FFT, dtype=torch.float64)
        win = 0.5 - 0.5 * torch.cos(2 * math.pi * n / N_FFT)  # periodic Hann, torch.hann_window default
        k = torch.arange(N_FFT // 2 + 1, dtype=torch.float64)[:, None]
        ang = 2 * math.pi * k * n[None] / N_FFT
        self.register_buffer("cos", (torch.cos(ang) * win).float()[:, None, :])
        self.register_buffer("sin", (-torch.sin(ang) * win).float()[:, None, :])
        fb = AF.melscale_fbanks(N_FFT // 2 + 1, 0.0, F_MAX, N_MELS, SR, norm=None, mel_scale="htk")
        self.register_buffer("fb", fb.T.contiguous().float())  # mels x bins

    def forward(self, x):  # x: 1 x samples
        x = nn.functional.pad(x[:, None, :], (N_FFT // 2, N_FFT // 2), mode="reflect")
        re = nn.functional.conv1d(x, self.cos, stride=HOP)
        im = nn.functional.conv1d(x, self.sin, stride=HOP)
        mel = torch.matmul(self.fb, re * re + im * im)  # 1 x mels x frames
        db = 10.0 * torch.log10(torch.clamp(mel, min=1e-10))
        return torch.maximum(db, db.amax() - TOP_DB)


class Addon(nn.Module):
    def __init__(self, das, ck):
        super().__init__()
        self.mel = LogMel()
        self.enc = das.encoder
        self.heads = nn.ModuleList()
        for st in ck["states"]:
            h = Head(ck["dim"], len(ck["vocab"])); h.load_state_dict(st); h.eval(); self.heads.append(h)
        self.register_buffer("mu", ck["mu"].float()); self.register_buffer("sd", ck["sd"].float())

    def forward(self, samples):
        x = self.mel(samples)[:, None]  # 1 x 1 x mels x frames: under 1,008 frames (10 s), so one encoder chunk
        x = self.enc.init_bn(x)
        x = self.enc.patch_embed(x)
        b, c, f, t = x.shape
        x = x + self.enc.time_pos_embed[:, :, :, :t] + self.enc.freq_pos_embed
        x = torch.permute(torch.flatten(x, 2, 3), (0, 2, 1))
        mid = None
        for i, blk in enumerate(self.enc.blocks):
            x = blk(x)
            if i == DAS_MID:
                mid = x
        h = self.enc.norm(x)[0]
        feat = torch.cat([h.mean(0), h.max(0).values, mid[0].mean(0)])[None]
        feat = (feat - self.mu) / self.sd
        return torch.stack([torch.sigmoid(m(feat)) for m in self.heads]).mean(0)


def reference(das, fe, ck, x16):
    """The PyTorch pipeline features.py and fit-teacher.py ran (float16 features, as stored)."""
    mid = {}
    hook = das.encoder.blocks[DAS_MID].register_forward_hook(lambda m, i, o: mid.setdefault("x", o))
    with torch.no_grad():
        iv = fe(x16, sampling_rate=SR, return_tensors="pt")["input_values"]
        h = das(iv).hidden_states[0]
        f = torch.cat([h.mean(0), h.max(0).values, mid["x"][0].mean(0)]).half().float().numpy()
    hook.remove()
    f = ((f - ck["mu"].numpy()) / ck["sd"].numpy()).astype(np.float32)[None]
    heads = []
    for st in ck["states"]:
        m = Head(ck["dim"], len(ck["vocab"])); m.load_state_dict(st); m.eval(); heads.append(m)
    with torch.no_grad():
        return np.mean([torch.sigmoid(m(torch.from_numpy(f))).numpy() for m in heads], 0)[0]


def clips():
    rng = np.random.default_rng(0)
    t = lambda s: np.arange(int(s * SR)) / SR
    yield "noise 10 s", (0.1 * rng.standard_normal(10 * SR)).astype(np.float32)
    yield "tone 3 s", (0.3 * np.sin(2 * np.pi * 440 * t(3))).astype(np.float32)
    clicks = np.zeros(int(4.5 * SR), np.float32); clicks[:: SR // 4] = 0.9
    yield "clicks 4.5 s", (np.convolve(clicks, np.exp(-np.arange(400) / 40.0))[: clicks.size] + 0.01 * rng.standard_normal(clicks.size)).astype(np.float32)
    yield "short 0.25 s", (0.2 * rng.standard_normal(4000)).astype(np.float32)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("teacher"); ap.add_argument("out"); ap.add_argument("--int8", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    from transformers import AutoFeatureExtractor, AutoModel

    das = AutoModel.from_pretrained(DAS, trust_remote_code=True).eval()
    fe = AutoFeatureExtractor.from_pretrained(DAS, trust_remote_code=True)
    ck = torch.load(os.path.join(a.teacher, "teacher.pt"), weights_only=False)
    assert ck["kind"] == "das" and ck["dim"] == 3840, (ck["kind"], ck["dim"])
    model = Addon(das, ck).eval()

    f32 = os.path.join(a.out, "model-fp32.onnx")
    with torch.no_grad():
        torch.onnx.export(model, (torch.zeros(1, 10 * SR),), f32, input_names=["samples16k"], output_names=["scores"],
                          dynamic_axes={"samples16k": {1: "n"}}, opset_version=17, dynamo=False)
    import onnxruntime as ort

    worst = {}
    sess = {"fp32": ort.InferenceSession(f32, providers=["CPUExecutionProvider"])}
    final = f32
    if a.int8:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        final = os.path.join(a.out, "model.onnx")
        quantize_dynamic(f32, final, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
        sess["int8"] = ort.InferenceSession(final, providers=["CPUExecutionProvider"])
    for name, x in clips():
        ref = reference(das, fe, ck, x)
        for k, s in sess.items():
            got = s.run(None, {"samples16k": x[None]})[0][0]
            d = float(np.abs(got - ref).max())
            worst[k] = max(worst.get(k, 0.0), d)
            print(f"{name:14s} {k}: max |onnx - pytorch| = {d:.4f}", flush=True)
    meta = {"name": "dge-dasheng-addon", "base": DAS, "classes": ck["vocab"], "input": {"name": "samples16k", "output": "scores",
            "sampleRate": SR, "maxSamples": 10 * SR, "minSamples": 4000}, "sha256": {"model.onnx": sha(final)},
            "parity": {k: round(v, 4) for k, v in worst.items()}}
    if not a.int8:
        os.replace(f32, os.path.join(a.out, "model.onnx"))
        meta["sha256"] = {"model.onnx": sha(os.path.join(a.out, "model.onnx"))}
    json.dump(meta, open(os.path.join(a.out, "model.json"), "w"), indent=1)
    print(json.dumps({"worst": worst, "MB": round(os.path.getsize(os.path.join(a.out, 'model.onnx')) / 1e6, 1)}))


if __name__ == "__main__":
    main()
