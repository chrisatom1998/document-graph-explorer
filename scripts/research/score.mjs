import { readFileSync, writeFileSync } from 'node:fs';
import { scoreTempo, scoreKey } from '../../src/audio/evaluationSignals';
import { digest, loadManifest, labelMetrics, bindingMetrics, retrievalMetrics } from './core.mjs';
const [file, predictions, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: vite-node scripts/research/score.mjs manifest.json run.json report.json');
const m = loadManifest(file), run = JSON.parse(readFileSync(predictions, 'utf8'));
if (run.manifestSha256 !== digest(readFileSync(file))) throw new Error('Run and manifest identity mismatch');
const byId = new Map(run.rows.map(r => [r.id, r]));
if (byId.size !== run.rows.length) throw new Error('Duplicate prediction');
const result = { model: run.model, note: 'Pilot; descriptive results, not a held-out accuracy claim.', durations: {} };
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
for (const duration of [...new Set(m.clips.map(c => c.seconds))]) {
  const clips = m.clips.filter(c => c.seconds === duration), rows = clips.map(c => byId.get(c.id) ?? { id: c.id, status: 'missing' });
  const tempo = [], key = [];
  for (const c of clips) {
    const r = byId.get(c.id), complete = r?.status === 'complete';
    if (run.model === 'dge-production' && Object.hasOwn(c.truth, 'tempo')) tempo.push({ id: c.id, ...scoreTempo(c.truth.tempo, complete ? r.tempo ?? null : null, .04), complete });
    if (run.model === 'dge-production' && Object.hasOwn(c.truth, 'key')) key.push({ id: c.id, ...scoreKey(c.truth.key, complete ? r.key ?? null : null), complete });
  }
  const times = rows.filter(r => r.status === 'complete' && Number.isFinite(r.elapsedMs)).map(r => r.elapsedMs).sort((a,b)=>a-b);
  const p = fraction => times.length ? times[Math.ceil(times.length * fraction) - 1] : null;
  result.durations[duration] = { clips: clips.length, complete: rows.filter(r => r.status === 'complete').length,
    labels: rows.some(r => Array.isArray(r.labels)) ? labelMetrics(clips, rows) : null, tempo, key,
    strictTempo: mean(tempo.filter(r => r.strict !== null).map(r => +r.strict)),
    octaveTolerantTempo: mean(tempo.filter(r => r.halfDouble !== null).map(r => +r.halfDouble)),
    exactKey: mean(key.filter(r => r.exact !== null).map(r => +r.exact)),
    weightedKey: mean(key.filter(r => r.weighted !== null).map(r => r.weighted)),
    correctNoPulse: mean(tempo.filter(r => r.noPulseCorrect !== null).map(r => +(r.complete && r.noPulseCorrect))),
    correctNoKey: mean(key.filter(r => r.noKeyCorrect !== null).map(r => +(r.complete && r.noKeyCorrect))),
    latency: { n: times.length, p50Ms: p(.5), observedP95Ms: p(.95),
      measuredSerialClipsPerSecond: times.length ? times.length * 1000 / times.reduce((a,b)=>a+b,0) : null,
      meanRealTimeFactor: times.length ? mean(times) / (duration * 1000) : null,
      coldRows: rows.filter(r => r.status === 'complete' && r.cold).map(r => ({ id: r.id, elapsedMs: r.elapsedMs })),
      warmRows: rows.filter(r => r.status === 'complete' && r.cold === false).map(r => ({ id: r.id, elapsedMs: r.elapsedMs })),
      note: 'Small pilot; aggregate mixes first-use and warm observations. Use coldRows/warmRows separately. Includes browser polling when run with run-dge.' },
    binding: bindingMetrics(rows.filter(r => clips.find(c => c.id === r.id)?.binding)),
    retrieval: retrievalMetrics(clips, rows) };
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
