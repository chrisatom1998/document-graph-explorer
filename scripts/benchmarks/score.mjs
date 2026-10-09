// CLI entry point: run with vite-node so the shipped TypeScript policy is used.
import { readFileSync, writeFileSync } from 'node:fs';
import { displayedPredictions, SOUND_DISPLAY_POLICY } from './displayed-predictions.mjs';
import { scoreClips, validateManifest } from './core.mjs';

const [manifestPath, graphPath, output, split = 'test'] = process.argv.slice(2);
if (!output) throw new Error('Usage: npx vite-node scripts/benchmarks/score.mjs <manifest.json> <graph.json> <report.json> [test|development]');
const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const reports = Object.fromEntries(['all', 'likely'].map(tier => [tier, scoreClips(manifest, displayedPredictions(manifest, graph, tier), { split })]));
writeFileSync(output, JSON.stringify({ displayPolicy: SOUND_DISPLAY_POLICY, ...reports }, null, 2) + '\n');
console.log(JSON.stringify({ report: output, clips: reports.all.clips, status: reports.all.status }));
if (!reports.all.complete) process.exitCode = 1;
