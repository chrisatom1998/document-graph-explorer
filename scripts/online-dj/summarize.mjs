// Prints the Sounds-panel tags DGE showed for each online track, next to the track's own source tags.
// Usage: npx vite-node scripts/online-dj/summarize.mjs <graph-export.json> <manifest.json> <out.json>
// Uses the app's own display function (confidentSoundSummary), exactly as the short-clip scorer does.
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';
import { keyName } from '../../src/audio/musicTypes';

const [exportPath, manifestPath, outPath] = process.argv.slice(2);
const graph = JSON.parse(readFileSync(exportPath, 'utf8'));
const { items } = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byName = new Map(graph.nodes.map(n => [n.path ?? n.title, n]));
const rows = [];
for (const item of items) {
  const audio = byName.get(`${item.id}.wav`)?.audio;
  if (!audio) { rows.push({ ...item, missing: true }); console.log(`\n${item.id}: NOT ANALYSED`); continue; }
  const shown = confidentSoundSummary(audio, audio.recognition?.mode).map(s => ({ dimension: s.dimension, label: s.label, maybe: !!s.maybe,
    score: s.scores?.length ? Math.max(...s.scores.map(x => x.score)) : null, models: s.scores?.map(x => x.model) }));
  const row = { ...item, status: audio.recognition?.status,
    jobs: Object.fromEntries((audio.recognition?.jobs ?? []).map(j => [j.modelId, j.unsupportedReason ? 'unsupported' : j.status])),
    shown, tempo: audio.tempo ?? null, key: audio.key ? keyName(audio.key) : null,
    instrumentPrediction: audio.instrumentPrediction ?? null,
    instruments: (audio.instruments ?? []).slice(0, 8), soundProfile: audio.soundProfile ?? null, notes: audio.notes };
  rows.push(row);
  console.log(`\n=== ${item.id} | ${item.genre} | "${item.title}" by ${item.artist} | ${item.source} ${item.license}`);
  console.log(`page: ${item.page}`);
  console.log(`source tags: ${item.sourceTags.join(', ')}`);
  if (item.description) console.log(`description: ${item.description.slice(0, 300)}`);
  console.log(`status: ${row.status}  jobs: ${JSON.stringify(row.jobs)}`);
  console.log(`tempo: ${row.tempo ? row.tempo.bpm.toFixed(1) + ' (conf ' + row.tempo.confidence.toFixed(2) + ')' : '-'}  key: ${row.key ?? '-'}`);
  console.log(`instrumentPrediction: ${JSON.stringify(row.instrumentPrediction)}`);
  for (const s of shown) console.log(`  [${s.dimension}] ${s.label}${s.maybe ? ' (maybe)' : ''}${s.score !== null ? ' ' + s.score.toFixed(2) : ''}  ${(s.models ?? []).join('; ')}`);
}
writeFileSync(outPath, JSON.stringify(rows, null, 1));
console.log(`\n${rows.filter(r => !r.missing).length}/${items.length} tracks analysed`);
