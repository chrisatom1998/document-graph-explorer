/* Computes the same 512-number CLAP sound fingerprint the app computes in the browser,
 * for every clip in a manifest, so heads trained on them read the app's own features.
 * Mirrors musicAnalysis.worker.ts: sound-model weights, q8, mono 48 kHz, first 10 s
 * (the processor otherwise picks a random 10 s window, which would not be repeatable).
 * Usage: embed-clap.mjs <manifest.json> <out.jsonl> [shardIndex shardCount] */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@huggingface/transformers';

const [MANIFEST, OUT, SHARD = '0', SHARDS = '1'] = process.argv.slice(2);
env.localModelPath = new URL('../public/', import.meta.url).pathname;
env.allowRemoteModels = false;

const decode = path => new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', path, '-t', '10', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const chunks = []; let err = '';
  ff.stdout.on('data', c => chunks.push(c));
  ff.stderr.on('data', d => { err += d; });
  ff.on('close', code => {
    if (code) return reject(new Error(err.trim().slice(0, 120) || `ffmpeg ${code}`));
    const buf = Buffer.concat(chunks);
    resolve(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice());
  });
});

const clips = JSON.parse(readFileSync(MANIFEST, 'utf8')).clips.filter((_, i) => i % Number(SHARDS) === Number(SHARD));
const done = new Set();
if (existsSync(OUT)) for (const line of readFileSync(OUT, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).id);
const todo = clips.filter(c => !done.has(c.id));
console.log(`shard ${SHARD}/${SHARDS}: ${clips.length} clips, ${done.size} already embedded, ${todo.length} to go`);

// Several workers share the machine; each one defaulting to every core makes all of them slower.
const THREADS = Number(process.env.THREADS || 0);
const session_options = THREADS ? { intraOpNumThreads: THREADS, interOpNumThreads: 1 } : undefined;
const model = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true, ...(session_options ? { session_options } : {}) });
const processor = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
const started = Date.now(); let n = 0, failed = 0;
for (const clip of todo) {
  try {
    const samples = await decode(clip.path);
    // The app skips near-silent input; a silent clip would teach nothing.
    if (samples.length < 4800 || samples.reduce((s, v) => s + v * v, 0) / samples.length < 1e-8) { failed++; continue; }
    const inputs = await processor(samples);
    const output = await model(inputs);
    appendFileSync(OUT, JSON.stringify({ id: clip.id, embedding: Array.from(output.audio_embeds.data, v => Math.round(v * 1e6) / 1e6) }) + '\n');
    n++;
  } catch (e) { failed++; if (failed <= 5) console.log(`  skip ${clip.id}: ${String(e.message).slice(0, 80)}`); }
  if ((n + failed) % 200 === 0) {
    const rate = n / ((Date.now() - started) / 1000);
    console.log(`  shard ${SHARD}: ${n + failed}/${todo.length}  ${rate.toFixed(1)}/s  ~${((todo.length - n - failed) / rate / 60).toFixed(0)} min left`);
  }
}
console.log(`shard ${SHARD} done: ${n} embedded, ${failed} skipped in ${((Date.now() - started) / 60000).toFixed(1)} min`);
