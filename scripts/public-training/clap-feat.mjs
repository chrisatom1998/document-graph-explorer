// clapRepeat only: the app's CLAP fingerprint for a short clip (repeat-padded to 10 s), exactly as short-clip-features.mjs.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@huggingface/transformers';
const [LIST, OUT, SHARD = '0', SHARDS = '1'] = process.argv.slice(2);
env.localModelPath = new URL('../../public/', import.meta.url).pathname; env.allowRemoteModels = false;
const decode = (path, rate) => new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', path, '-t', '10', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']);
  const chunks = []; ff.stdout.on('data', c => chunks.push(c));
  ff.on('close', code => { if (code) return reject(new Error('ffmpeg ' + code)); const b = Buffer.concat(chunks); resolve(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice()); });
});
const clips = JSON.parse(readFileSync(LIST, 'utf8')).filter((_, i) => i % Number(SHARDS) === Number(SHARD));
const done = new Set(); if (existsSync(OUT)) for (const l of readFileSync(OUT, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).id);
const session_options = { intraOpNumThreads: Number(process.env.THREADS || 1), interOpNumThreads: 1 };
const clap = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options });
const proc = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
const r = v => Math.round(v * 1e5) / 1e5; let n = 0; const t0 = Date.now();
for (const c of clips.filter(c => !done.has(c.id))) {
  try { const s = await decode(c.path, 48000); const out = await clap(await proc(s));
    appendFileSync(OUT, JSON.stringify({ id: c.id, seconds: s.length / 48000, clapRepeat: Array.from(out.audio_embeds.data, r), event: true }) + '\n');
  } catch (e) { console.log('skip', c.id, String(e.message).slice(0, 80)); }
  if (++n % 250 === 0) console.log(`shard ${SHARD}: ${n} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(`shard ${SHARD} done ${n}`);
