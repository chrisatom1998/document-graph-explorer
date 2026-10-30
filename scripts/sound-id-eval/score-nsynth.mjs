/** Score NSynth test notes with the app's CLAP q8 encoder and the trained tagger.
 *
 *   node scripts/sound-id-eval/score-nsynth.mjs \
 *     --examples /path/nsynth-test/examples.json \
 *     --audio /path/nsynth-test/audio \
 *     --out .cache/nsynth-scores.jsonl
 *
 * Needs ffmpeg, the CLAP weights at public/sound-model/onnx/audio_model_quantized.onnx and
 * public/tagger-model/model.onnx (npm run setup:music). Safe to resume. Audio is not committed.
 */
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const examplesPath = opt('examples');
const audioDir = opt('audio');
const outPath = opt('out', '.cache/nsynth-scores.jsonl');
if (!examplesPath || !audioDir) {
  console.error('Pass --examples <examples.json> and --audio <wav dir>. See the header.');
  process.exit(2);
}
const examples = JSON.parse(readFileSync(examplesPath, 'utf8'));
const done = new Set();
if (existsSync(outPath)) {
  for (const line of readFileSync(outPath, 'utf8').split('\n')) {
    if (!line) continue;
    try { done.add(JSON.parse(line).id); } catch { /* a torn last line is skipped; that id is scored again */ }
  }
}
const ids = Object.keys(examples).filter(id => !done.has(id));
console.log(`scored ${done.size}, remaining ${ids.length}`);
if (!ids.length) process.exit(0);

const tf = await import('@huggingface/transformers');
tf.env.allowRemoteModels = false;
tf.env.allowLocalModels = true;
tf.env.localModelPath = new URL('../../public/', import.meta.url).pathname;
const clap = await tf.ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 } });
const processor = await tf.AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
const ort = await import('onnxruntime-node');
const tagger = await ort.InferenceSession.create(new URL('../../public/tagger-model/model.onnx', import.meta.url).pathname, { executionProviders: ['cpu'], intraOpNumThreads: 4, interOpNumThreads: 1 });
const classes = JSON.parse(readFileSync(new URL('../../public/tagger-model/model.json', import.meta.url), 'utf8')).classes;
const keep = classes.map((name, i) => ({ name, i })).filter(({ name }) => /guitar|mallet|marimba|xylophone|vibraphone|glockenspiel|piano|organ|flute|string|keyboard|synth|bass|brass|reed|vocal|bell|drum/i.test(name));

function decode(path, rate) {
  const bytes = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const out = createWriteStream(outPath, { flags: 'a' });
const started = performance.now();
let n = 0;
for (const id of ids) {
  const meta = examples[id];
  const pcm48 = decode(`${audioDir}/${id}.wav`, 48000);
  const pcm32 = decode(`${audioDir}/${id}.wav`, 32000);
  const inputs = await processor(pcm48);
  const output = await clap(inputs);
  const embedding = Array.from(output.audio_embeds.data, v => Math.round(v * 1e6) / 1e6);
  await output.audio_embeds.dispose?.();
  const padded = new Float32Array(320000);
  padded.set(pcm32.subarray(0, 320000));
  const scores = (await tagger.run({ samples32k: new ort.Tensor('float32', padded, [1, 320000]) })).scores.data;
  const taggerScores = {};
  for (const { name, i } of keep) taggerScores[name] = Math.round(scores[i] * 1e6) / 1e6;
  const rec = { id, instrument: meta.instrument_str, family: meta.instrument_family_str, source: meta.instrument_source_str, pitch: meta.pitch, velocity: meta.velocity, duration: pcm32.length / 32000, embedding, tagger: taggerScores };
  if (!out.write(JSON.stringify(rec) + '\n')) await new Promise(r => out.once('drain', r));
  n++;
  if (n % 50 === 0 || n === ids.length) {
    const rate = n / ((performance.now() - started) / 1000);
    console.log(`${done.size + n}/${done.size + ids.length}  ${rate.toFixed(2)}/s`);
  }
}
await new Promise(r => out.end(r));
await clap.dispose();
await tagger.release();
console.log('score done');
