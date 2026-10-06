/* Per-file features for the versions test set, computed the way the app computes them:
 * the version print (src/audio/versionPrint.ts, 16 kHz mono) and the 512-number CLAP sound
 * fingerprint averaged over every ten-second window (full mode, as analyzeDecodedMusic does).
 * Usage: npx vite-node scripts/versions/features.ts <manifest.json> <out.jsonl> [shard shards] */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@huggingface/transformers';
import { computeVersionPrint, VERSION_PRINT_SAMPLE_RATE } from '../../src/audio/versionPrint';
import { descriptionStarts } from '../../src/audio/analysisPlan';
import { meanEmbedding } from '../../src/audio/profileDescriptions';

const [MANIFEST, OUT, SHARD = '0', SHARDS = '1'] = process.argv.slice(2);
env.localModelPath = new URL('../../public/', import.meta.url).pathname;
env.allowRemoteModels = false;

function decode(path: string, rate: number): Float32Array {
  const r = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status) throw new Error(String(r.stderr).slice(0, 160));
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4).slice();
}

type File = { id: string; path: string };
const files = (JSON.parse(readFileSync(MANIFEST, 'utf8')).files as File[]).filter((_, i) => i % Number(SHARDS) === Number(SHARD));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
const THREADS = Number(process.env.THREADS || 0);
const model = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true,
  ...(THREADS ? { session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 } } : {}) });
const processor = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
for (const file of files) {
  if (done.has(file.id)) continue;
  const started = Date.now();
  const pcm16 = decode(file.path, VERSION_PRINT_SAMPLE_RATE);
  const duration = pcm16.length / VERSION_PRINT_SAMPLE_RATE;
  const print = await computeVersionPrint(async (start, seconds) => pcm16.slice(Math.round(start * VERSION_PRINT_SAMPLE_RATE), Math.round((start + seconds) * VERSION_PRINT_SAMPLE_RATE)), duration);
  const pcm48 = decode(file.path, 48000);
  const vectors: number[][] = [];
  for (const start of descriptionStarts(duration, 'full')) {
    const samples = pcm48.slice(Math.round(start * 48000), Math.round(Math.min(duration, start + 10) * 48000));
    if (samples.length < 4800 || samples.reduce((s, v) => s + v * v, 0) / samples.length < 1e-8) continue;
    const output = await model(await processor(samples));
    vectors.push(Array.from(output.audio_embeds.data as Float32Array));
  }
  appendFileSync(OUT, JSON.stringify({ id: file.id, duration, print, embedding: meanEmbedding(vectors) }) + '\n');
  console.log(`${file.id}: ${duration.toFixed(0)} s, ${vectors.length} windows, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
