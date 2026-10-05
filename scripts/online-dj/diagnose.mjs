// Why does a clip get no tags? Prints, per clip: fusion decisions per window (all labels, not only accepted ones),
// native evidence, job errors, and the raw (unthresholded) CLAP trained-head scores computed the app's way.
// Also prints each window's CLAP embedding (base64 float32) on an "EMB" line so heads can be re-scored offline.
// Usage: npx vite-node scripts/online-dj/diagnose.mjs <graph-export.json> <manifest.json> <audio-dir>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { env, AutoProcessor, ClapAudioModelWithProjection } from '@huggingface/transformers';
import { instrumentWindowStarts } from '../../src/audio/instrumentEvidence';

const [exportPath, manifestPath, audioDir] = process.argv.slice(2);
const graph = JSON.parse(readFileSync(exportPath, 'utf8'));
const { items } = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byName = new Map(graph.nodes.map(n => [n.path ?? n.title, n]));
env.localModelPath = new URL('../../public/', import.meta.url).pathname;
env.allowRemoteModels = false;
const model = await ClapAudioModelWithProjection.from_pretrained('sound-model', { dtype: 'q8', device: 'cpu', local_files_only: true });
const processor = await AutoProcessor.from_pretrained('sound-model', { local_files_only: true });
const learned = JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8'));
const f2 = v => v === null || v === undefined ? '-' : Number(v).toFixed(2);
for (const item of items) {
  const audio = byName.get(`${item.id}.wav`)?.audio;
  console.log(`\n##### ${item.id} (${item.genre})`);
  if (!audio) { console.log('not analysed'); continue; }
  for (const j of audio.recognition?.jobs ?? []) if (j.error || j.status !== 'complete') console.log(`job ${j.modelId}: ${j.status} ${j.error ?? ''} ${j.unsupportedReason ?? ''}`);
  const f = audio.fusion;
  if (f) {
    console.log(`fusion validation=${f.validation} counts=${JSON.stringify(f.counts)} omitted=${f.omittedWindows}`);
    for (const w of f.windows) {
      console.log(` window ${w.start}-${w.end} ${w.status} ${w.reason ?? ''}`);
      for (const d of [...w.decisions].sort((a, b) => (b.headProbability ?? 0) - (a.headProbability ?? 0)).slice(0, 8))
        console.log(`   ${d.label.padEnd(17)} head=${f2(d.headProbability)} decision=${f2(d.decisionProbability)} ${d.state} ${d.source} eligible=${d.eligible} +${d.positiveGroups}/-${d.negativeGroups}`);
    }
  } else console.log('no fusion');
  const ev = audio.recognition?.evidence ?? [];
  for (const model of ['ast', 'jamendo', 'clap']) {
    const best = new Map();
    for (const e of ev.filter(e => e.modelId === model)) best.set(`${e.dimension}:${e.labelId}`, Math.max(best.get(`${e.dimension}:${e.labelId}`) ?? 0, e.score));
    console.log(` evidence ${model}: ${[...best].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, s]) => `${k} ${f2(s)}`).join(', ')}`);
  }
  console.log(` djTags: ${(audio.soundProfile?.djTags ?? []).map(t => `${t.group}:${t.label} ${f2(t.score)} ${t.model ?? ''}`).join(', ')}`);
  const duration = audio.durationSeconds;
  for (const start of instrumentWindowStarts(duration)) {
    const bytes = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-i', join(audioDir, `${item.id}.wav`), '-t', '10', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 8_000_000 });
    const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const out = await model(await processor(samples));
    const emb = Float32Array.from(out.audio_embeds.data);
    const norm = Math.hypot(...emb);
    const raw = learned.heads.map(h => {
      const logit = h.bias + h.weights.reduce((s, w, i) => s + w * emb[i] / norm, 0);
      return { key: `${h.group}:${h.label}`, score: 1 / (1 + Math.exp(-logit)), threshold: h.threshold };
    }).sort((a, b) => b.score / b.threshold - a.score / a.threshold);
    console.log(` clap heads @${start}s: ${raw.slice(0, 12).map(r => `${r.key} ${f2(r.score)}/${f2(r.threshold)}`).join(', ')}`);
    const src = raw.filter(r => r.key.startsWith('source:'));
    console.log(` clap source heads @${start}s: ${src.map(r => `${r.key.slice(7)} ${f2(r.score)}/${f2(r.threshold)}`).join(', ')}`);
    console.log(`EMB ${JSON.stringify({ id: item.id, start, b64: Buffer.from(emb.buffer).toString('base64') })}`);
  }
}
await model.dispose();
