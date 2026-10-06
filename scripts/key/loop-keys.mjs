// Keys of short loops the way the app reads them (one excerpt: the whole file, up to 60 s), with the old Essentia
// profile, the learned chroma profiles and the key network side by side.
// Usage: npx vite-node scripts/key/loop-keys.mjs <clips.json [{ id, path, truth: { tonic, mode } }]> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { essentiaKey, excerptChroma, recordingKey } from '../../src/audio/key';
import { detectRepeatedPitch } from '../../src/audio/detectedPitch';
import { keyProbabilities, loadKeyCnn, recordingKeyFromProbabilities } from '../../src/audio/keyCnn';

const [clipsPath, outPath] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
const engine = new Essentia(EssentiaWASM);
await loadKeyCnn(readFileSync('public/key-model/key-cnn.onnx'));
const rows = [];
for (const clip of clips) {
  let raw;
  try { raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clip.path, '-t', '60', '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { console.log(`${clip.id}: cannot decode, skipped`); continue; }
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const row = { ...clip };
  delete row.path;
  try {
    let pitch;
    if (samples.length < 8 * 44100) { try { pitch = detectRepeatedPitch(engine, samples); } catch { /* as the worker */ } }
    const chroma = excerptChroma(engine, samples, pitch);
    // The old app: Essentia's default profile behind the same gates.
    const old = chroma ? essentiaKey(engine, samples) : undefined;
    row.bgate = old && old.strength >= 0.6 ? old : null;
    row.profiles = chroma ? recordingKey([chroma], 1) ?? null : null;
    row.bgateRaw = old ?? null;
    row.probabilities = chroma ? (await keyProbabilities(engine, samples)).map(v => +v.toFixed(5)) : null;
    row.cnn = row.probabilities ? recordingKeyFromProbabilities([row.probabilities], 1) ?? null : null;
  } catch (error) { row.error = String(error); }
  rows.push(row);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} loops written to ${outPath}`);
