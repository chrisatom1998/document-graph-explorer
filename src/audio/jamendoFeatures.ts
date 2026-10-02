import type Essentia from 'essentia.js/dist/essentia.js-core.es.js';
/** Official EffnetDiscogs preprocessing: 16 kHz, centered 512/256 frames,
 * MusiCNN mel bands, complete 128-frame patches at a 62-frame hop. */
export function jamendoPatches(engine: Pick<Essentia, 'arrayToVector' | 'vectorToArray' | 'TensorflowInputMusiCNN'>, samples: Float32Array): Float32Array[] {
  if (samples.length < 32768) return [];
  const frames = 1 + Math.ceil((samples.length - 256) / 256);
  const mel = new Float32Array(frames * 96);
  for (let i = 0; i < frames; i++) {
    const frame = new Float32Array(512); const start = i * 256 - 256;
    const from = Math.max(0, start); const end = Math.min(samples.length, start + 512);
    frame.set(samples.subarray(from, end), from - start);
    const vector = engine.arrayToVector(frame);
    try {
      const { bands } = engine.TensorflowInputMusiCNN(vector);
      try { mel.set(engine.vectorToArray(bands), i * 96); } finally { bands.delete(); }
    } finally { vector.delete(); }
  }
  const patches: Float32Array[] = [];
  for (let start = 0; start + 128 <= frames; start += 62) patches.push(mel.slice(start * 96, (start + 128) * 96));
  return patches;
}
