// Tempo and key for short loops exactly as the app's music worker computes them (one excerpt, whole file), using the worker's own key functions.
// Usage: npx vite-node scripts/loops/loop-features.mjs <clips.json> <out.json>
// clips.json: [{ id, path, ...truth }]; every field is copied to the output row.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { estimateTempo } from '../../src/audio/tempo';
import { detectRepeatedPitch } from '../../src/audio/detectedPitch';
import { combineKeys, excerptKey } from '../../src/audio/key';

const [clipsPath, outPath] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
const engine = new Essentia(EssentiaWASM);
const rows = [];
for (const [n, clip] of clips.entries()) {
  // The app decodes files up to 60 s as a single mono 44.1 kHz excerpt.
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clip.path, '-t', '60', '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const row = { ...clip, key_true: clip.key, seconds: samples.length / 44100 };
  try { const t = estimateTempo(engine, samples); row.tempo = t ? { bpm: t.bpm, confidence: t.confidence } : null; } catch (e) { row.tempo = null; row.error = String(e); }
  row.key = null; row.pitch = null;
  try {
    // Same order as musicAnalysis.worker.ts for a single excerpt.
    let pitch;
    if (samples.length < 8 * 44100) { try { pitch = detectRepeatedPitch(engine, samples); } catch { /* as the worker */ } }
    const one = excerptKey(engine, samples, pitch);
    const key = combineKeys(one ? [one] : [], 1);
    if (key) row.key = key;
    else {
      if (!pitch && samples.length >= 8 * 44100) { try { pitch = detectRepeatedPitch(engine, samples); } catch { /* as the worker */ } }
      if (pitch) row.pitch = pitch.pitchClass;
    }
  } catch (e) { row.keyError = String(e); }
  rows.push(row);
  if (n % 25 === 0) console.log(`${n + 1}/${clips.length}`);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips written to ${outPath}`);
