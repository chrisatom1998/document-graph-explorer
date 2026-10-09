// Run with vite-node: use exactly the shipped display policy, not a second detector implementation.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { confidentSoundSummary, SOUND_DISPLAY_POLICY } from '../../src/audio/confidentSoundSummary';
import { scoreClips, validateManifest } from './core.mjs';

export function displayedPredictions(manifest, graph, tier = 'all') {
  const byName = new Map();
  for (const node of graph.nodes ?? []) {
    const name = node.path ?? node.title;
    if (byName.has(name)) throw new Error(`Ambiguous graph filename: ${name}`);
    byName.set(name, node);
  }
  return manifest.clips.map(c => {
    const node = byName.get(c.file), audio = node?.audio;
    if (audio?.confirmedInstruments?.length || audio?.confirmedDjTags || audio?.soundReviews?.length || audio?.copilotProperties) {
      throw new Error(`Corrected/assisted audio cannot be used as a blind prediction: ${c.id}`);
    }
    const shown = audio ? confidentSoundSummary(audio, audio.recognition?.mode) : [];
    return { id: c.id, status: audio?.stage === 'preview' ? 'missing' : audio?.recognition?.status ?? 'missing',
      labels: shown.filter(s => tier === 'all' || (!s.maybe && !s.uncalibrated && !s.coverageUnknown && s.tier !== 'possible'))
        .map(s => `${s.dimension}:${s.label}`) };
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [manifestPath, graphPath, output, split = 'test'] = process.argv.slice(2);
  if (!output) throw new Error('Usage: npx vite-node scripts/benchmarks/score.mjs <manifest.json> <graph.json> <report.json> [test|development]');
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const reports = Object.fromEntries(['all', 'likely'].map(tier => [tier, scoreClips(manifest, displayedPredictions(manifest, graph, tier), { split })]));
  writeFileSync(output, JSON.stringify({ displayPolicy: SOUND_DISPLAY_POLICY, ...reports }, null, 2) + '\n');
  console.log(JSON.stringify({ report: output, clips: reports.all.clips, status: reports.all.status }));
  if (!reports.all.complete) process.exitCode = 1;
}
