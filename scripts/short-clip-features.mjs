/* Cache the features the short-clip experiments compare, computed exactly as the app's worker would.
 *   clapRepeat: CLAP sound fingerprint, clip repeated to fill 10 s (the app's current behaviour)
 *   clapZero:   CLAP fingerprint, clip followed by silence (no looping)
 *   ast:        all 527 AudioSet AST logits on the unchanged clip (the model pads features itself)
 *   event:      attack/body/decay features from src/audio/eventFeatures.ts on unchanged 16 kHz audio
 * Usage: node scripts/short-clip-features.mjs <list.json: [{id,path}]> <out.jsonl> [shard shards] */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { env, AutoProcessor, ClapAudioModelWithProjection, AutoModelForAudioClassification } from '@huggingface/transformers';
import { eventFeatures } from '../src/audio/eventFeatures.ts';

const [LIST, OUT, SHARD = '0', SHARDS = '1'] = process.argv.slice(2);
env.localModelPath = new URL('../public/', import.meta.url).pathname;
env.allowRemoteModels = false;
const decode = (path, rate) => new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', path, '-t', '10', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']);
  const chunks = []; let err = '';
  ff.stdout.on('data', c => chunks.push(c)); ff.stderr.on('data', d => { err += d; });
  ff.on('close', code => {
    if (code) return reject(new Error(err.slice(0, 120)));
    const b = Buffer.concat(chunks);
    resolve(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice());
  });
});
const clips = JSON.parse(readFileSync(LIST, 'utf8')).filter((_, i) => i % Number(SHARDS) === Number(SHARD));
const done = new Set();
if (existsSync(OUT)) for (const line of readFileSync(OUT, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).id);
const THREADS = Number(process.env.THREADS || 2);
const session_options = { intraOpNumThreads: THREADS, interOpNumThreads: 1 };
const clap = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options });
const clapProc = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
const ast = await AutoModelForAudioClassification.from_pretrained('music-model', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options });
const astProc = await AutoProcessor.from_pretrained('music-model', { local_files_only: true });
const fx = clapProc.feature_extractor;
const r = v => Math.round(v * 1e5) / 1e5;
async function clapEmbed(samples, padding) {
  fx.config.padding = padding;
  try { const out = await clap(await clapProc(samples)); return Array.from(out.audio_embeds.data, r); }
  finally { fx.config.padding = 'repeatpad'; }
}
let n = 0; const t0 = Date.now();
for (const clip of clips.filter(c => !done.has(c.id))) {
  try {
    const s48 = await decode(clip.path, 48000), s16 = await decode(clip.path, 16000);
    const row = { id: clip.id, seconds: s16.length / 16000 };
    row.clapRepeat = await clapEmbed(s48, 'repeatpad');
    row.clapZero = await clapEmbed(s48, 'pad');
    row.ast = Array.from((await ast(await astProc(s16))).logits.data, r);
    row.event = eventFeatures(s16) ?? null;
    appendFileSync(OUT, JSON.stringify(row) + '\n');
  } catch (e) { console.log(`skip ${clip.id}: ${String(e.message).slice(0, 100)}`); }
  if (++n % 200 === 0) console.log(`shard ${SHARD}: ${n} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`shard ${SHARD} done: ${n}`);
