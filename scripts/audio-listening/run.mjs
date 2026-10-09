// npx vite-node scripts/audio-listening/run.mjs manifest.json baseline.json audio-dir output-dir [limit=20]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { loadEnv } from 'vite';
import { reviewAudio } from '../../src/server/gptAudioReview';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';
import { classesFor, score } from './score.mjs';
import { listeningExcerpt } from './excerpt';

const [manifestPath, baselinePath, audioDir, outputDir, limitArg = '20'] = process.argv.slice(2);
if (!outputDir) throw Error('Usage: npx vite-node scripts/audio-listening/run.mjs manifest.json baseline.json audio-dir output-dir [limit=20]');
const limit = Number(limitArg);
if (!Number.isInteger(limit) || limit < 1 || limit > 900) throw Error('Limit must be 1–900; each clip makes one paid request (no retries).');
const key = process.env.OPENAI_API_KEY || loadEnv('development', process.cwd(), 'OPENAI_API_KEY').OPENAI_API_KEY;
if (!key) throw Error('The existing OPENAI_API_KEY is unavailable here. Run in the checkout containing your .env.local or existing environment key.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = readFileSync(manifestPath), baselineBytes = readFileSync(baselinePath);
const manifest = JSON.parse(manifestBytes), baseline = JSON.parse(baselineBytes);
const native = new Map();
if (Array.isArray(baseline)) {
  for (const row of baseline) if (row.status === 'complete' && Array.isArray(row.shown)) {
    if (row.shown.some(t => t.origin === 'confirmed by you')) throw Error('Baseline must contain model estimates only.');
    native.set(row.id, classesFor(row.shown.filter(t => t.dimension === 'source').map(t => t.label)));
  }
} else {
  for (const node of baseline.nodes ?? []) if (node.audio) {
    const shown = confidentSoundSummary(node.audio, node.audio.recognition?.mode);
    if (shown.some(t => t.origin === 'confirmed by you')) throw Error('Baseline must contain model estimates only.');
    native.set((node.path ?? node.title).replace(/\.[^.]+$/, ''), classesFor(shown.filter(t => t.dimension === 'source').map(t => t.label)));
  }
}
// Fixed id-hash order, independent of ground truth and model output. No cherry-picking failures.
const selected = manifest.items.filter(i => i.split === 'test').sort((a, b) => hash(a.id).localeCompare(hash(b.id))).slice(0, limit);
if (!selected.length) throw Error('No test clips.');
for (const item of selected) {
  if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || !native.has(item.id)) throw Error(`Missing completed native baseline for ${item.id}.`);
  if (item.start !== 0 || item.end > 10 || item.end <= 0) throw Error('Use annotations for the same first 10 seconds, not a whole track.');
  if (item.rights?.evaluationAllowed !== true) throw Error('Manifest must explicitly allow evaluation of each clip.');
  readFileSync(join(audioDir, `${item.id}.wav`)); // Preflight all inputs before incurring API costs.
}
mkdirSync(outputDir, { recursive: true });
const records = [], client = new OpenAI({ apiKey: key, maxRetries: 0, timeout: 90_000 });
let usage;
const create = client.chat.completions.create.bind(client.chat.completions);
client.chat.completions.create = async (...args) => {
  const response = await create(...args); usage = response.usage; return response;
};
for (const item of selected) {
  const record = { id: item.id, native: native.get(item.id), audio: [] };
  const started = performance.now(); usage = undefined;
  try {
    const file = join(audioDir, `${item.id}.wav`);
    record.sourceSha256 = hash(readFileSync(file));
    const bytes = listeningExcerpt(file, item.end); record.excerptSha256 = hash(bytes);
    const sample = { ref: 'Sample 1', durationSeconds: item.end, analyzedSeconds: item.end, preview: false,
      tempo: null, key: null, confirmedTags: null, confirmedInstruments: null, estimates: [], filenameHints: { bpm: null, key: null } };
    // Ground truth, titles, file names and native predictions never enter this call.
    const result = await reviewAudio(client, [sample], [{ ref: sample.ref, wav: bytes.toString('base64') }],
      'Describe the clearly audible sources in this excerpt.', AbortSignal.timeout(90_000));
    record.audio = classesFor(result.suggestions.flatMap(s => s.tags.source));
    record.suggestions = result.suggestions; record.coverage = result.listening;
  } catch (e) { record.error = { name: e.name, status: e.status ?? null }; }
  record.elapsedMs = Math.round(performance.now() - started); record.usage = usage ?? null;
  records.push(record);
  // Checkpoint every response so interruptions do not lose paid results. No audio or secrets saved.
  writeFileSync(join(outputDir, 'responses.json'), JSON.stringify(records, null, 2));
  const report = { model: 'gpt-audio-1.5', manifestSha256: hash(manifestBytes), baselineSha256: hash(baselineBytes),
    requested: selected.length, completed: records.length, failures: records.filter(r => r.error).length,
    policy: 'Fixed union, agreement and native-unless-empty fallback; no tuning on test labels.',
    scores: score(selected, records), cost: 'Token usage recorded per request; monetary cost not estimated.' };
  writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${records.length}/${selected.length}: ${record.error ? 'failed' : 'complete'}`);
  if (record.error?.status === 401 || record.error?.status === 403 || record.error?.status === 429) break;
}
