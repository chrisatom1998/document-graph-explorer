// Tempo features for offline tuning: the app's own estimate plus raw Essentia estimators and an onset tempogram.
// Usage: npx vite-node scripts/tempo/features.mjs <clips.json> <out.json> [shard i/n]
// clips.json: [{ id, path, ...anything }]; every field is copied to the output row.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { estimateTempo } from '../../src/audio/tempo';

const [clipsPath, outPath, shard] = process.argv.slice(2);
let clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
if (shard) { const [i, n] = shard.split('/').map(Number); clips = clips.filter((_, k) => k % n === i); }
const engine = new Essentia(EssentiaWASM);
const FPS = 44100 / 512;
const grid = Array.from({ length: 211 }, (_, k) => 40 + k);   // 40..250 BPM
const rows = [];
const t0 = Date.now();
for (const [n, clip] of clips.entries()) {
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clip.path, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const row = { ...clip, seconds: +(samples.length / 44100).toFixed(2) };
  try { const a = estimateTempo(engine, samples); row.app = a ? { bpm: a.bpm, confidence: a.confidence } : null; } catch (e) { row.app = null; row.error = String(e); }
  const vector = engine.arrayToVector(samples);
  try {
    for (const method of ['multifeature', 'degara']) {
      try {
        const r = engine.RhythmExtractor2013(vector, 208, method, 40);
        row[method] = { bpm: +r.bpm.toFixed(2), confidence: +r.confidence.toFixed(3), ticks: r.ticks.size(),
          estimates: [...engine.vectorToArray(r.estimates)].map(v => +v.toFixed(1)) };
        r.ticks.delete(); r.estimates.delete(); r.bpmIntervals.delete();
      } catch { row[method] = null; }
    }
    try { row.percival = +engine.PercivalBpmEstimator(vector).bpm.toFixed(2); } catch { row.percival = null; }
    // Autocorrelation of the beat-emphasis onset function at each grid tempo (linear interpolation of the lag).
    try {
      const odfVec = engine.OnsetDetectionGlobal(vector, 2048, 512, 'beat_emphasis', 44100).onsetDetections;
      const odf = engine.vectorToArray(odfVec); odfVec.delete();
      const mean = odf.reduce((s, v) => s + v, 0) / odf.length, x = Array.from(odf, v => v - mean);
      const ac = lag => { let s = 0; for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]; return s / (x.length - lag); };
      const zero = ac(0) || 1;
      row.tempogram = grid.map(bpm => { const lag = 60 * FPS / bpm, l0 = Math.floor(lag), f = lag - l0; return +(((1 - f) * ac(l0) + f * ac(l0 + 1)) / zero).toFixed(4); });
    } catch { row.tempogram = null; }
  } finally { vector.delete(); }
  rows.push(row);
  if (n % 50 === 0) console.log(`${n + 1}/${clips.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips written to ${outPath}`);
