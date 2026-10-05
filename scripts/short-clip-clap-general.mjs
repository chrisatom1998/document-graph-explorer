/* Cache a second CLAP fingerprint for short-clip development clips, computed exactly like clapRepeat
 * (scripts/short-clip-features.mjs) but with laion/larger_clap_general (Apache-2.0) instead of the app's
 * larger_clap_music_and_speech. Same audio config and preprocessor; 48 kHz, first 10 s, repeat-padded, q8.
 * The model is NOT in public/: download Xenova/larger_clap_general@d78c3994912c441f0151a5cc44d86f6b7bf4c861
 * (config.json, preprocessor_config.json, onnx/audio_model_quantized.onnx) into $W/models/larger_clap_general.
 * Development clips only (calibration + train + Surge train); the frozen test split is never read.
 * Usage: node scripts/short-clip-clap-general.mjs [shard shards]   -> $W/clap-general-<shard>.jsonl */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@huggingface/transformers';

const W = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips';
const [SHARD = '0', SHARDS = '1'] = process.argv.slice(2);
const OUT = `${W}/clap-general-${SHARD}.jsonl`;
env.localModelPath = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/models/';
env.allowRemoteModels = false;
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const manifest = json(new URL('../docs/evaluations/short-clips-2026-10-04/manifest.json', import.meta.url));
const testIds = new Set(manifest.items.filter(i => i.split === 'test').map(i => i.id));
const dev = [...manifest.items.filter(i => i.split === 'calibration'),
  ...['train-items.json', 'train-items-surge.json'].filter(f => existsSync(`${W}/${f}`)).flatMap(f => json(`${W}/${f}`).items)].map(i => i.id);
if (dev.some(id => testIds.has(id))) throw new Error('test clips must never be embedded here');
const paths = new Map(['feature-list.json', 'feature-list-surge.json'].filter(f => existsSync(`${W}/${f}`)).flatMap(f => json(`${W}/${f}`)).map(r => [r.id, r.path]));
const done = new Set();
for (const f of readdirSync(W).filter(f => /^clap-general-\d+\.jsonl$/.test(f)))
  for (const line of readFileSync(`${W}/${f}`, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).id);
const clips = dev.filter((id, i) => i % Number(SHARDS) === Number(SHARD) && !done.has(id) && paths.has(id));

const decode = path => new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', path, '-t', '10', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const chunks = []; let err = '';
  ff.stdout.on('data', c => chunks.push(c)); ff.stderr.on('data', d => { err += d; });
  ff.on('close', code => {
    if (code) return reject(new Error(err.slice(0, 120)));
    const b = Buffer.concat(chunks);
    resolve(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice());
  });
});
const session_options = { intraOpNumThreads: Number(process.env.THREADS || 2), interOpNumThreads: 1 };
const clap = await ClapAudioModelWithProjection.from_pretrained('larger_clap_general', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options });
const proc = await AutoProcessor.from_pretrained('larger_clap_general', { local_files_only: true });
const r = v => Math.round(v * 1e5) / 1e5;
let n = 0; const t0 = Date.now();
console.log(`shard ${SHARD}/${SHARDS}: ${done.size} cached, ${clips.length} to embed`);
for (const id of clips) {
  try {
    const out = await clap(await proc(await decode(paths.get(id))));
    appendFileSync(OUT, JSON.stringify({ id, clapGeneral: Array.from(out.audio_embeds.data, r) }) + '\n');
  } catch (e) { console.log(`skip ${id}: ${String(e.message).slice(0, 100)}`); }
  if (++n % 200 === 0) console.log(`shard ${SHARD}: ${n}/${clips.length} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`shard ${SHARD} done: ${n}`);
