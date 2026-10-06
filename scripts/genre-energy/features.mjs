// Genre/energy features for offline fitting: the app's own EffnetDiscogs pass over each 10 s analysis window.
// Usage: npx vite-node scripts/genre-energy/features.mjs <clips.json> <out.json> [model dir] [extra heads dir]
// clips.json: [{ id, path (16 kHz mono WAV), ... }]; every field except path is copied to the output row.
// Per track: Discogs style scores (mean over the full-mode windows, and the single fast-mode window), the 1280-d
// embedding for both (bfloat16, base64), optional extra-head means (MTG-Jamendo mood/theme), and loudness.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as ort from 'onnxruntime-web';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { jamendoPatches } from '../../src/audio/jamendoFeatures';
import { instrumentWindowStarts } from '../../src/audio/instrumentEvidence';
import { descriptionStarts } from '../../src/audio/analysisPlan';

const [clipsPath, outPath, modelDir = 'public/jamendo-model', headsDir] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
ort.env.wasm.numThreads = 1;
const engine = new Essentia(EssentiaWASM);
const embed = await ort.InferenceSession.create(readFileSync(`${modelDir}/discogs-effnet-bsdynamic-1.onnx`));
const heads = [];
for (const name of ['mtg_jamendo_moodtheme']) {
  const file = headsDir && `${headsDir}/${name}-discogs-effnet-1`;
  if (!file || !existsSync(`${file}.onnx`)) continue;
  heads.push({ name, session: await ort.InferenceSession.create(readFileSync(`${file}.onnx`)), classes: JSON.parse(readFileSync(`${file}.json`, 'utf8')).classes });
}
const bf16 = values => { const f = new Float32Array(values), u = new Uint16Array(f.length), w = new Uint32Array(f.buffer);
  for (let i = 0; i < f.length; i++) u[i] = (w[i] + 0x7fff + ((w[i] >> 16) & 1)) >>> 16; return Buffer.from(u.buffer).toString('base64'); };
const round = values => Array.from(values, v => +v.toFixed(4));

/** One app window: mean style scores, mean embedding and mean head scores over its 128-frame patches. */
async function window(samples) {
  const patches = jamendoPatches(engine, samples);
  if (!patches.length) return undefined;
  const input = new Float32Array(patches.length * 128 * 96);
  patches.forEach((p, k) => input.set(p, k * 128 * 96));
  const out = await embed.run({ melspectrogram: new ort.Tensor('float32', input, [patches.length, 128, 96]) });
  const mean = (data, width) => { const m = new Float64Array(width); for (let k = 0; k < patches.length; k++) for (let j = 0; j < width; j++) m[j] += data[k * width + j] / patches.length; return m; };
  const styles = mean(out.activations.data, 400), embedding = mean(out.embeddings.data, 1280);
  const extra = {};
  for (const head of heads) {
    const r = await head.session.run({ [head.session.inputNames[0]]: out.embeddings });
    extra[head.name] = mean(r[head.session.outputNames[0]].data, head.classes.length);
  }
  return { styles, embedding, extra };
}
const average = (rows, pick) => { const m = new Float64Array(pick(rows[0]).length); for (const r of rows) pick(r).forEach((v, j) => { m[j] += v / rows.length; }); return m; };

const rows = [];
const t0 = Date.now();
for (const [n, clip] of clips.entries()) {
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clip.path, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const row = { ...clip }; delete row.path;
  const duration = samples.length / 16000;
  row.seconds = +duration.toFixed(2);
  const at = start => samples.subarray(Math.round(start * 16000), Math.min(samples.length, Math.round((start + 10) * 16000)));
  const fast = await window(at(descriptionStarts(duration, 'fast')[0]));
  // FAST_ONLY=1 skips the full-mode windows (quick local runs); the full fields then repeat the fast window.
  const full = [];
  if (process.env.FAST_ONLY === '1') { if (fast) full.push(fast); }
  else for (const start of instrumentWindowStarts(duration)) { const w = await window(at(start)); if (w) full.push(w); }
  if (!full.length || !fast) { row.error = 'too short'; rows.push(row); continue; }
  row.windows = full.length;
  row.styles = round(average(full, w => w.styles));
  row.stylesFast = round(fast.styles);
  row.embedding = bf16(average(full, w => w.embedding));
  row.embeddingFast = bf16(fast.embedding);
  for (const head of heads) {
    row[head.name] = round(average(full, w => w.extra[head.name]));
    row[`${head.name}Fast`] = round(fast.extra[head.name]);
  }
  // Loudness proxy: mean and spread of 1 s RMS in dB.
  const db = [];
  for (let s = 0; s + 16000 <= samples.length; s += 16000) { let e = 0; for (let k = s; k < s + 16000; k++) e += samples[k] * samples[k]; db.push(10 * Math.log10(e / 16000 + 1e-10)); }
  const mu = db.reduce((a, b) => a + b, 0) / db.length;
  row.rmsDb = +mu.toFixed(2); row.rmsDbSpread = +Math.sqrt(db.reduce((a, b) => a + (b - mu) ** 2, 0) / db.length).toFixed(2);
  rows.push(row);
  if (n % 25 === 0) console.log(`${n + 1}/${clips.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} tracks written to ${outPath}; heads: ${heads.map(h => h.name).join(', ') || 'none'}`);
