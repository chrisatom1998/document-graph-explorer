// Per-window model outputs for training and tuning the full-mix instrument heads, computed with the app's own models
// and preprocessing: CLAP sound embedding (48 kHz, q8), all 527 AudioSet AST logits (16 kHz, q8), and the Discogs-EffNet
// embedding plus MTG-Jamendo instrument activations averaged over the window's patches (16 kHz, src/audio/jamendoFeatures).
// Windows follow the app's own plan (src/audio/instrumentEvidence instrumentWindowStarts: 10 s, 5 s hop).
// Usage: npx vite-node scripts/full-mix-heads/features.mjs <clips.json: [{id,path}]> <out-prefix> [shard i/n]
// Writes <out-prefix>.f32 (rows of FEATURE_LENGTH little-endian float32) and <out-prefix>.jsonl ({id,start,end} per row).
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { env, AutoProcessor, ClapAudioModelWithProjection, AutoModelForAudioClassification } from '@huggingface/transformers';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { jamendoPatches } from '../../src/audio/jamendoFeatures';
import { instrumentWindowStarts } from '../../src/audio/instrumentEvidence';

export const BLOCKS = { clap: 512, ast: 527, jamendo: 40, effnet: 1280 };
const FEATURE_LENGTH = Object.values(BLOCKS).reduce((a, b) => a + b, 0);
const [clipsPath, prefix, shard] = process.argv.slice(2);
let clips = JSON.parse(readFileSync(clipsPath, 'utf8'));
if (shard) { const [i, n] = shard.split('/').map(Number); clips = clips.filter((_, k) => k % n === i); }

const root = new URL('../../public/', import.meta.url).pathname;
env.localModelPath = root;
env.allowRemoteModels = false;
const THREADS = Number(process.env.THREADS || 4);
const session_options = { intraOpNumThreads: THREADS, interOpNumThreads: 1 };
const clap = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options });
const clapProc = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
const ast = await AutoModelForAudioClassification.from_pretrained('music-model', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options });
const astProc = await AutoProcessor.from_pretrained('music-model', { local_files_only: true });
const ort = createRequire(import.meta.url)('onnxruntime-node');
const jroot = `${root}jamendo-model/`;
const embed = await ort.InferenceSession.create(`${jroot}discogs-effnet-bsdynamic-1.onnx`, { intraOpNumThreads: THREADS });
const head = await ort.InferenceSession.create(`${jroot}mtg_jamendo_instrument-discogs-effnet-1.onnx`, { intraOpNumThreads: THREADS });
const engine = new Essentia(EssentiaWASM);

const decode = (path, rate) => {
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
};
async function jamendo(samples) {
  const patches = jamendoPatches(engine, samples);
  const act = new Float64Array(BLOCKS.jamendo), emb = new Float64Array(BLOCKS.effnet);
  for (const patch of patches) {
    const { embeddings } = await embed.run({ melspectrogram: new ort.Tensor('float32', patch, [1, 128, 96]) });
    const { activations } = await head.run({ embeddings });
    for (let i = 0; i < act.length; i++) act[i] += activations.data[i] / patches.length;
    for (let i = 0; i < emb.length; i++) emb[i] += embeddings.data[i] / patches.length;
  }
  return patches.length ? { act, emb } : undefined;
}

const binPath = `${prefix}.f32`, metaPath = `${prefix}.jsonl`;
const done = new Set();
if (existsSync(metaPath)) { for (const line of readFileSync(metaPath, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).id); }
else { writeFileSync(binPath, ''); writeFileSync(metaPath, ''); }
let n = 0, failed = 0; const t0 = Date.now();
for (const clip of clips.filter(c => !done.has(c.id))) {
  try {
    const s16 = decode(clip.path, 16000), s48 = decode(clip.path, 48000);
    const duration = s16.length / 16000;
    const rows = [], metas = [];
    for (const start of instrumentWindowStarts(duration)) {
      const end = Math.min(duration, start + 10);
      // The app only scores fully decoded windows; a recording shorter than 2.048 s has no Jamendo output.
      const w16 = s16.slice(Math.round(start * 16000), Math.round(end * 16000)), w48 = s48.slice(Math.round(start * 48000), Math.round(end * 48000));
      const j = await jamendo(w16);
      if (!j) continue;
      const c = await clap(await clapProc(w48));
      const a = await ast(await astProc(w16));
      const row = new Float32Array(FEATURE_LENGTH);
      // The worker posts the embedding rounded to 4 decimals (musicAnalysis.worker.ts); match it. On the shipped heads the
      // rounding moves no probability by more than 1e-4 and flips no decision on the 1,900 benchmark clips.
      row.set(Array.from(c.audio_embeds.data, v => Math.round(v * 1e4) / 1e4), 0);
      row.set(a.logits.data, BLOCKS.clap);
      row.set(j.act, BLOCKS.clap + BLOCKS.ast);
      row.set(j.emb, BLOCKS.clap + BLOCKS.ast + BLOCKS.jamendo);
      rows.push(row); metas.push(JSON.stringify({ id: clip.id, start: +start.toFixed(3), end: +end.toFixed(3) }));
    }
    // A clip's windows land together, so a resumed run never holds half a clip.
    for (const row of rows) appendFileSync(binPath, Buffer.from(row.buffer));
    if (metas.length) appendFileSync(metaPath, metas.join('\n') + '\n');
  } catch (e) { failed++; console.log(`skip ${clip.id}: ${String(e.message).slice(0, 120)}`); }
  if (++n % 100 === 0) console.log(`${n}/${clips.length} in ${((Date.now() - t0) / 60000).toFixed(1)} min (${failed} failed)`);
}
console.log(`done: ${n} clips, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
