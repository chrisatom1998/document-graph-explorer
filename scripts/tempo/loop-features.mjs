// Loop tempo features in Node, with the app's own code: the Essentia estimate (as the worker aggregates one excerpt)
// each tempo CNN's reading of the tiled whole file, and how seamlessly the file wraps (src/audio/loopWrap.ts). Usage:
// npx vite-node scripts/tempo/loop-features.mjs <clips.json> <out.json> <name=model.onnx>... ; clips.json: [{ id, path, ... }]
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import * as ort from 'onnxruntime-web';
import { countAttacks, estimateTempo } from '../../src/audio/tempo';
import { cnnTempo, tempoMel, tempoWindows } from '../../src/audio/tempoCnn';
import { wrapDropPercentile } from '../../src/audio/loopWrap';

const [clipsPath, outPath, ...modelArgs] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
ort.env.wasm.numThreads = 1;
const models = [];
for (const arg of modelArgs) {
  const [name, file] = arg.split('=');
  models.push({ name, session: await ort.InferenceSession.create(readFileSync(file)) });
}
const engine = new Essentia(EssentiaWASM);
const rows = [];
const t0 = Date.now();
for (const [n, clip] of clips.entries()) {
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clip.path, '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const row = { ...clip, seconds: samples.length / 44100 };
  try {
    const a = estimateTempo(engine, samples);
    row.app = a ? { bpm: Math.round(a.bpm * 10) / 10, confidence: a.confidence, ...(a.alternatives ? { alternatives: a.alternatives } : {}) } : null;
  } catch (e) { row.app = null; row.error = String(e); }
  row.wrap = wrapDropPercentile(samples) ?? null;
  { const v = engine.arrayToVector(samples); try { row.attacks = countAttacks(engine, v); } finally { v.delete(); } }
  const windows = tempoWindows(tempoMel(samples));
  if (windows.length) {
    const input = new Float32Array(windows.length * 215 * 40);
    windows.forEach((w, i) => input.set(w, i * 215 * 40));
    for (const { name, session } of models) {
      const tensor = new ort.Tensor('float32', input, [windows.length, 215, 40]);
      try {
        const out = await session.run({ mel: tensor });
        try { row[name] = cnnTempo(out.logits.data, windows.length); }
        finally { for (const t of Object.values(out)) t.dispose(); }
      } finally { tensor.dispose(); }
    }
  }
  rows.push(row);
  if (n % 50 === 0) console.log(`${n + 1}/${clips.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips written to ${outPath}`);
