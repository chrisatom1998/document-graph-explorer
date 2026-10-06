// Tempo and key for short loops exactly as the app's music worker computes them (one excerpt, whole file).
// Usage: npx vite-node scripts/loops/loop-features.mjs <clips.json> <out.json>
// clips.json: [{ id, path, ...truth }]; every field is copied to the output row.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { estimateTempo } from '../../src/audio/tempo';
import { detectRepeatedPitch } from '../../src/audio/detectedPitch';

const [clipsPath, outPath] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
const engine = new Essentia(EssentiaWASM);
const TONICS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
// Copied from musicAnalysis.worker.ts (not exported there).
function hasPitchDiversity(samples) {
  const bins = new Float32Array(12);
  for (let i = 0; i < 12 && samples.length >= 4096; i++) {
    const start = Math.floor((samples.length - 4096) * i / 12);
    const frame = engine.arrayToVector(samples.slice(start, start + 4096));
    const windowed = engine.Windowing(frame).frame;
    const spectrum = engine.Spectrum(windowed).spectrum;
    const peaks = engine.SpectralPeaks(spectrum);
    const hpcp = engine.HPCP(peaks.frequencies, peaks.magnitudes).hpcp;
    const values = engine.vectorToArray(hpcp);
    for (let j = 0; j < 12; j++) bins[j] += values[j];
    for (const v of [frame, windowed, spectrum, peaks.frequencies, peaks.magnitudes, hpcp]) v.delete();
  }
  const ranked = [...bins].sort((a, b) => b - a);
  return ranked[0] > 0 && ranked[2] > ranked[0] * 0.18;
}
const rows = [];
for (const [n, clip] of clips.entries()) {
  // The app decodes files up to 60 s as a single mono 44.1 kHz excerpt.
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clip.path, '-t', '60', '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const row = { ...clip, key_true: clip.key, seconds: samples.length / 44100 };
  try { const t = estimateTempo(engine, samples); row.tempo = t ? { bpm: t.bpm, confidence: t.confidence } : null; } catch (e) { row.tempo = null; row.error = String(e); }
  row.key = null; row.pitch = null;
  try {
    let pitch;
    if (samples.length < 8 * 44100) { try { pitch = detectRepeatedPitch(engine, samples); } catch { /* as the worker */ } }
    if (!(pitch && pitch.confidence >= 0.9) && samples.length >= 3 * 44100 && hasPitchDiversity(samples)) {
      const v = engine.arrayToVector(samples);
      try {
        const k = engine.KeyExtractor(v);
        if (TONICS[k.key] !== undefined && (k.scale === 'major' || k.scale === 'minor') && k.strength >= 0.6) row.key = { tonic: TONICS[k.key], mode: k.scale, strength: k.strength };
      } finally { v.delete(); }
    }
    if (!row.key) {
      if (!pitch && samples.length >= 8 * 44100) { try { pitch = detectRepeatedPitch(engine, samples); } catch { /* as the worker */ } }
      if (pitch) row.pitch = pitch.pitchClass;
    }
  } catch (e) { row.keyError = String(e); }
  rows.push(row);
  if (n % 25 === 0) console.log(`${n + 1}/${clips.length}`);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips written to ${outPath}`);
