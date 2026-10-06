// Run Essentia's key estimator with each key profile on a set of clips, for tuning the app's key profile offline.
// Usage: npx vite-node scripts/dj-fix/key-profiles.mjs <out.json> <manifest.json> <audio-dir>
// Mirrors the app's key path (src/audio/musicAnalysis.worker.ts): mono 44.1 kHz samples of the whole clip, the same
// pitch-diversity gate and KeyExtractor defaults; only profileType varies. The app shows a key at strength >= 0.6.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';

const PROFILES = ['bgate', 'edma', 'edmm', 'krumhansl', 'temperley', 'temperley2005', 'shaath', 'noland', 'braw'];
const [outPath, manifestPath, audioDir] = process.argv.slice(2);
const engine = new Essentia(EssentiaWASM);
function hasPitchDiversity(samples) {   // copy of the worker's gate
  const bins = new Float32Array(12);
  for (let i = 0; i < 12 && samples.length >= 4096; i++) {
    const start = Math.floor((samples.length - 4096) * i / 12);
    const frame = engine.arrayToVector(samples.slice(start, start + 4096));
    const windowed = engine.Windowing(frame).frame, spectrum = engine.Spectrum(windowed).spectrum, peaks = engine.SpectralPeaks(spectrum);
    const hpcp = engine.HPCP(peaks.frequencies, peaks.magnitudes).hpcp, values = engine.vectorToArray(hpcp);
    for (let j = 0; j < 12; j++) bins[j] += values[j];
    for (const v of [frame, windowed, spectrum, peaks.frequencies, peaks.magnitudes, hpcp]) v.delete();
  }
  const ranked = [...bins].sort((a, b) => b - a);
  return ranked[0] > 0 && ranked[2] > ranked[0] * 0.18;
}
const rows = [];
for (const item of JSON.parse(readFileSync(manifestPath, 'utf8')).items) {
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', `${audioDir}/${item.id}.wav`, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 27 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const row = { id: item.id, genre: item.genre, truth: item.key, diverse: hasPitchDiversity(samples), profiles: {} };
  for (const p of PROFILES) {
    const v = engine.arrayToVector(samples);
    try { const k = engine.KeyExtractor(v, true, 4096, 4096, 12, 3500, 60, 25, 0.2, p, 44100, 0.0001, 440, 'cosine', 'hann'); row.profiles[p] = { key: k.key, scale: k.scale, strength: +k.strength.toFixed(4) }; }
    catch (e) { row.profiles[p] = { error: String(e?.message ?? e) }; }
    finally { v.delete(); }
  }
  rows.push(row);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips, ${PROFILES.length} profiles -> ${outPath}`);
