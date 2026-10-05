// Prints the exact Sounds-panel tags (with possible/likely tier) for every audio node in a DGE graph export,
// using the app's own display functions. Usage: npx vite-node scripts/ui-export-tags.mjs <graph-export.json> [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../src/audio/confidentSoundSummary';
import { filenameSoundFallback } from '../src/audio/filenameSoundFallback';
const [path, out] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(path, 'utf8')).nodes.filter(n => n.audio).map(node => {
  const a = node.audio, scored = confidentSoundSummary(a, a.recognition?.mode);
  return { file: node.path ?? node.title, seconds: a.durationSeconds, status: a.recognition?.status,
    jobs: Object.fromEntries((a.recognition?.jobs ?? []).map(j => [j.modelId, j.unsupportedReason ? 'unsupported' : j.status])),
    tempo: a.tempo?.bpm ?? null, key: a.key ? `${a.key.tonic ?? a.key.key ?? ''} ${a.key.scale ?? ''}`.trim() : null,
    tags: scored.map(s => `${s.dimension}:${s.label}${s.tier ? ` [${s.tier}]` : ''}${s.maybe ? ' (maybe)' : ''} ${(s.scores ?? []).map(x => `${x.model} ${x.score.toFixed(2)}`).join(', ')}`),
    filename: filenameSoundFallback(a, node, scored).map(s => s.label) };
});
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(JSON.stringify(r, null, 1));
