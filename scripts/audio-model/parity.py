"""Reference scores for the browser tagger's parity test (src/audio/tagger.parity.test.ts).

Usage: python3 scripts/audio-model/parity.py <model.onnx> <out.json>

Builds the same synthetic test signal the TypeScript test builds (sines, a gated tone and a 32-bit LCG noise, as int16
32 kHz mono), cuts it the way the held-out scorers did and scores it with onnxruntime on the CPU:
  * up to 30 s: evaluate.py's windows() (whole 10 s windows from the start, one padded window when shorter than 10 s);
  * longer: the middle 30 s excerpt first (prepare-holdout.py), then windows().
A recording's score per output is the maximum over its windows (evaluate.py scores()). Writes, per duration, the
window starts in seconds and the scores of every output the app's policy (src/audio/taggerPolicy.json) uses.
"""
import json, math, os, sys
import numpy as np
import onnxruntime as ort

SR, WIN = 32000, 320000
DURATIONS = [4.5, 10.0, 25.0, 47.0]

def signal(seconds):
    """Must match taggerParitySignal() in src/audio/tagger.parity.test.ts."""
    n = int(round(seconds * SR)); out = np.zeros(n, np.int16); state = 12345
    for i in range(n):
        t = i / SR
        state = (state * 1664525 + 1013904223) % 4294967296
        noise = state / 4294967296 - 0.5
        x = 0.25 * math.sin(2 * math.pi * 110 * t) + 0.15 * math.sin(2 * math.pi * 1760 * t) * (1 if math.sin(2 * math.pi * 2 * t) > 0 else 0) \
            + 0.1 * math.sin(2 * math.pi * (300 + 40 * (t % 5)) * t) + 0.08 * noise
        out[i] = max(-32768, min(32767, math.floor(x * 32767 + 0.5)))
    return out

def windows(x):   # evaluate.py
    x = np.asarray(x, np.float32) / 32768; n = max(1, len(x) // WIN)
    return [np.pad(x[k * WIN:(k + 1) * WIN], (0, max(0, WIN - len(x[k * WIN:(k + 1) * WIN])))) for k in range(n)]

def main():
    model, out = sys.argv[1:3]
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
    policy = json.load(open(os.path.join(root, 'src', 'audio', 'taggerPolicy.json')))
    classes = json.load(open(os.path.join(os.path.dirname(model), 'model.json')))['classes']
    sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
    cases = []
    for d in DURATIONS:
        x = signal(d); offset = 0
        if len(x) > 3 * WIN:   # prepare-holdout.py: the middle 30 s
            offset = (len(x) - 3 * WIN) // 2; x = x[offset:offset + 3 * WIN]
        ws = windows(x)
        scores = np.max(np.stack([sess.run(None, {'samples32k': w[None]})[0][0] for w in ws]), axis=0)
        cases.append({'seconds': d, 'starts': [(offset + k * WIN) / SR for k in range(len(ws))],
                      'scores': {t['output']: round(float(scores[classes.index(t['output'])]), 6) for t in policy['tags']}})
    json.dump({'model': policy['modelSha256'], 'sampleRate': SR, 'cases': cases}, open(out, 'w'), indent=1)
    print(f'wrote {out}')

if __name__ == '__main__':
    main()
