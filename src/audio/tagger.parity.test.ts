import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from './taggerParity.fixture.json';
import { TAGGER_POLICY, TAGGER_SAMPLE_RATE, TAGGER_WINDOW_SAMPLES, TaggerEvidence, taggerWindow, taggerWindowStarts } from './tagger';

/** The browser front end (window cutting, padding and max-over-windows) against the Python one the tagger was scored
 * with: scripts/audio-model/parity.py wrote the fixture with onnxruntime on the CPU, cutting windows as evaluate.py and
 * prepare-holdout.py did. Here the same signal goes through the app's own helpers and onnxruntime-web (wasm). The model
 * is a downloaded asset (npm run setup:music), so the inference half skips when it is absent. */
const MODEL = 'public/tagger-model/model.onnx';

/** Must match signal() in scripts/audio-model/parity.py. */
function taggerParitySignal(seconds: number): Float32Array {
  const n = Math.round(seconds * TAGGER_SAMPLE_RATE), out = new Float32Array(n);
  let state = 12345;
  for (let i = 0; i < n; i++) {
    const t = i / TAGGER_SAMPLE_RATE;
    state = (state * 1664525 + 1013904223) % 4294967296;
    const noise = state / 4294967296 - 0.5;
    const x = 0.25 * Math.sin(2 * Math.PI * 110 * t) + 0.15 * Math.sin(2 * Math.PI * 1760 * t) * (Math.sin(2 * Math.PI * 2 * t) > 0 ? 1 : 0)
      + 0.1 * Math.sin(2 * Math.PI * (300 + 40 * (t % 5)) * t) + 0.08 * noise;
    out[i] = Math.max(-32768, Math.min(32767, Math.floor(x * 32767 + 0.5))) / 32768;
  }
  return out;
}

describe('trained tagger front end', () => {
  it('holds reference scores for every policy output', () => {
    for (const c of fixture.cases) expect(Object.keys(c.scores).sort()).toEqual(TAGGER_POLICY.tags.map(t => t.output).sort());
  });
  it('cuts the same windows as the Python scorers', () => {
    for (const c of fixture.cases) expect(taggerWindowStarts(c.seconds)).toEqual(c.starts);
  });
  it('pads a short window with silence and keeps a full one as is', () => {
    const short = taggerWindow(new Float32Array([0.5, -0.5]));
    expect(short.length).toBe(TAGGER_WINDOW_SAMPLES);
    expect([short[0], short[1], short[2], short[TAGGER_WINDOW_SAMPLES - 1]]).toEqual([0.5, -0.5, 0, 0]);
    const full = new Float32Array(TAGGER_WINDOW_SAMPLES);
    expect(taggerWindow(full)).toBe(full);
  });
  it.skipIf(!existsSync(MODEL))('scores within 1e-3 of the Python front end and onnxruntime', async () => {
    const bytes = readFileSync(MODEL);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(TAGGER_POLICY.modelSha256);
    expect(fixture.model).toBe(TAGGER_POLICY.modelSha256);
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    const classes = (JSON.parse(readFileSync('public/tagger-model/model.json', 'utf8')) as { classes: string[] }).classes;
    let worst = 0;
    for (const c of fixture.cases) {
      const audio = taggerParitySignal(c.seconds), evidence = new TaggerEvidence();
      for (const start of taggerWindowStarts(c.seconds)) {
        const from = Math.round(start * TAGGER_SAMPLE_RATE);
        const input = new ort.Tensor('float32', taggerWindow(audio.slice(from, from + TAGGER_WINDOW_SAMPLES)), [1, TAGGER_WINDOW_SAMPLES]);
        const scores = (await session.run({ [TAGGER_POLICY.input.name]: input }))[TAGGER_POLICY.input.output].data as Float32Array;
        evidence.add(Object.fromEntries(classes.map((label, i) => [label, scores[i]])));
      }
      const result = evidence.results()!;
      for (const [output, want] of Object.entries(c.scores)) worst = Math.max(worst, Math.abs(result.scores[output] - want));
    }
    // The two runtimes differ by float32 rounding only.
    expect(worst).toBeLessThan(1e-3);
  }, 120_000);
});
