// Key features for offline tuning: the app's own key (the key network; the chroma-profile key as chromaKey), Essentia's extractor with two profiles, and the mean chroma
// (also per second, for models of how harmony moves).
// Usage: npx vite-node scripts/key/features.mjs <clips.json> <out.json>
// clips.json rows (scripts/key/build-sets.py): { id, path, plan: 'excerpt' | 'song' | 'blocks', start, seconds, duration, ... };
// every field except path is copied to the output row. A 'song' row is cut into the app's own tempo/key excerpts.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { chromaFeatures, essentiaKey, excerptChroma, hasPitchDiversity, recordingKey } from '../../src/audio/key';
import { detectRepeatedPitch } from '../../src/audio/detectedPitch';
import { keyProbabilities, loadKeyCnn, recordingKeyFromProbabilities } from '../../src/audio/keyCnn';

const [clipsPath, outPath] = process.argv.slice(2);
const clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
const engine = new Essentia(EssentiaWASM);
await loadKeyCnn(readFileSync('public/key-model/key-cnn.onnx'));
// The key network was trained on the tuning sets, so its output is recorded only for the held-out sets.
const heldOut = set => !set.startsWith('tune-');
const round = values => values.map(v => +v.toFixed(4));
const decode = (path, start, seconds) => {
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(start), '-t', String(seconds), '-i', path, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
};
// src/audio/analyzeDecodedMusic.ts: three 20 s excerpts of a recording over 60 s, else its first 60 s.
const songPlan = d => d > 60 ? [Math.max(0, d * .1 - 10), d * .5 - 10, Math.min(d - 20, d * .9 - 10)].map(s => [s, 20]) : [[0, Math.min(d, 60)]];
// 'blocks': the whole file as consecutive 10 s excerpts (a shorter tail is dropped).
const blockPlan = d => Array.from({ length: Math.floor(d / 10) }, (_, i) => [i * 10, 10]);
const rows = [];
const t0 = Date.now();
for (const [n, clip] of clips.entries()) {
  const { path, ...row } = clip;
  try {
    const plan = clip.plan === 'song' ? songPlan(clip.duration) : clip.plan === 'blocks' ? blockPlan(clip.duration) : [[clip.start, clip.seconds]];
    const all = plan.map(([s, secs]) => decode(path, s, secs));
    const chromas = [], probabilities = [];
    row.excerpts = [];
    for (const samples of all.filter(s => s.reduce((sum, v) => sum + v * v, 0) / s.length > 1e-8)) {
      const e = { seconds: +(samples.length / 44100).toFixed(2) };
      if (samples.length < 8 * 44100) { try { e.pitch = detectRepeatedPitch(engine, samples); } catch { /* as in the worker */ } }
      const appChroma = excerptChroma(engine, samples, e.pitch);
      if (appChroma) chromas.push(appChroma);
      if (heldOut(clip.set)) {
        e.cnn = round(await keyProbabilities(engine, samples));
        if (appChroma) probabilities.push(e.cnn);
      }
      e.diverse = samples.length >= 4096 && hasPitchDiversity(engine, samples);
      for (const profile of ['bgate', 'edma']) { try { e[profile] = essentiaKey(engine, samples, profile) ?? null; } catch { e[profile] = null; } }
      const chroma = chromaFeatures(engine, samples, true, true);
      e.full = chroma ? round(chroma.full) : null;
      e.bass = chroma ? round(chroma.bass) : null;
      e.perSecond = chroma ? chroma.seconds.map(round) : null;
      row.excerpts.push(e);
    }
    row.excerptCount = all.length;
    row.chromaKey = recordingKey(chromas, all.length) ?? null;
    // The app's key: the network on the excerpts that pass the tonal gates (src/audio/musicAnalysis.worker.ts).
    if (heldOut(clip.set)) row.appKey = recordingKeyFromProbabilities(probabilities, all.length) ?? null;
  } catch (error) { row.error = String(error); }
  rows.push(row);
  if (n % 100 === 0) console.log(`${n + 1}/${clips.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips written to ${outPath}`);
