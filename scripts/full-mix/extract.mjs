// Compact per-clip record of what the app showed and the native scores behind it, for offline calibration.
// Usage: npx vite-node scripts/full-mix/extract.mjs <out.json> <graph-export.json>...
// "shown" uses the checked-out app's own display function (confidentSoundSummary).
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';

const [outPath, ...exportPaths] = process.argv.slice(2);
const rows = [];
for (const path of exportPaths) for (const node of JSON.parse(readFileSync(path, 'utf8')).nodes) {
  const audio = node.audio;
  if (!audio) continue;
  const max = (model, minSeconds = 0) => {
    const best = {};
    for (const e of audio.recognition?.evidence ?? []) if (e.modelId === model && e.end - e.start >= minSeconds - 1e-6) best[`${e.dimension}:${e.labelId}`] = Math.max(best[`${e.dimension}:${e.labelId}`] ?? 0, +e.score.toFixed(4));
    return best;
  };
  const fusion = {};
  for (const w of audio.fusion?.windows ?? []) for (const d of w.decisions) if (d.headProbability !== null)
    fusion[d.label] = Math.max(fusion[d.label] ?? 0, +d.headProbability.toFixed(4));
  rows.push({ id: (node.path ?? node.title).replace(/\.[^.]+$/, ''), duration: audio.durationSeconds, status: audio.recognition?.status,
    jobs: Object.fromEntries((audio.recognition?.jobs ?? []).map(j => [j.modelId, j.status])),
    shown: confidentSoundSummary(audio, audio.recognition?.mode).map(s => ({ dimension: s.dimension, label: s.label, maybe: !!s.maybe, tier: s.tier,
      score: s.scores?.length ? +Math.max(...s.scores.map(x => x.score)).toFixed(4) : null, models: s.scores?.map(x => x.model) })),
    jamendo: max('jamendo'), jamendoFullWindows: max('jamendo', 10), ast: max('ast'), fusion, fusionCounts: audio.fusion?.counts ?? null });
}
writeFileSync(outPath, JSON.stringify(rows));
console.log(`${rows.length} clips extracted to ${outPath}`);
