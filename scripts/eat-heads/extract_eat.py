"""Frozen EAT-base clip embeddings, CPU only (worstchan/EAT-base_epoch30_finetune_AS2M, MIT code and weights).

Each 10 s window -> [CLS, mean of frame tokens] (1536-d); clip = mean over up to three windows.
128-bin kaldi fbank, 1024 frames, normalised with mean -4.268 and std 4.569 * 2 (EAT's AS2M settings).
Needs torch, torchaudio, soundfile and transformers (trust_remote_code loads EAT's model code from the pinned revision).
Decode streamed FLACs to 16 kHz WAV first (ffmpeg) if soundfile cannot read their length.

Usage: extract_eat.py <list.tsv: id<TAB>path> <out.npz> [threads]"""
import sys, time
import numpy as np
import soundfile as sf
import torch
import torchaudio
from transformers import AutoModel

MODEL = 'worstchan/EAT-base_epoch30_finetune_AS2M'
REVISION = '60d61e8b2e9e5ba3be6860285de80cb7d625ccbb'
W = 16000 * 10


def main():
    torch.set_num_threads(int(sys.argv[3]) if len(sys.argv) > 3 else 4)
    m = AutoModel.from_pretrained(MODEL, revision=REVISION, trust_remote_code=True).eval()
    rows = [line.rstrip('\n').split('\t')[:2] for line in open(sys.argv[1]) if line.strip()]

    def emb(w):
        w = w - w.mean()
        mel = torchaudio.compliance.kaldi.fbank(w.unsqueeze(0), htk_compat=True, sample_frequency=16000,
                                                use_energy=False, window_type='hanning', num_mel_bins=128, dither=0.0,
                                                frame_shift=10).unsqueeze(0)
        mel = torch.nn.ZeroPad2d((0, 0, 0, max(0, 1024 - mel.shape[1])))(mel)[:, :1024]
        mel = ((mel + 4.268) / (4.569 * 2)).unsqueeze(0)
        with torch.no_grad():
            f = m.extract_features(mel)[0]
        return torch.cat([f[0], f[1:].mean(0)]).numpy()

    ids, E, t = [], [], time.time()
    for k, (i, p) in enumerate(rows):
        try:
            w, sr = sf.read(p, always_2d=True, dtype='float32')
        except Exception as e:  # noqa: BLE001 - keep going on unreadable files and list them
            print('SKIP', i, e, flush=True)
            continue
        w = torch.from_numpy(w.mean(1))
        if sr != 16000:
            w = torchaudio.functional.resample(w, sr, 16000)
        if len(w) < 1600:
            w = torch.nn.functional.pad(w, (0, 1600 - len(w)))
        starts = list(range(0, max(1, len(w) - W // 2), W))[:3] if len(w) > W else [0]
        E.append(np.mean([emb(w[s:s + W]) for s in starts], 0))
        ids.append(i)
        if k % 200 == 0:
            print(k, round(time.time() - t), flush=True)
    np.savez(sys.argv[2], ids=np.array(ids), emb=np.array(E, dtype=np.float32))
    print('done', len(ids), round(time.time() - t), 's')


if __name__ == '__main__':
    main()
