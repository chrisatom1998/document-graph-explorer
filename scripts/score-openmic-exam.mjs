// Score the frozen OpenMIC song exam from DGE graph exports, using the app's own display functions.
// Usage: npx vite-node scripts/score-openmic-exam.mjs <train|test> <label>=<graph-export.json> [...]
// Outputs: "Sounds panel" (confidentSoundSummary source tags, i.e. what the panel shows), "possible list"
// (analysis.instruments) and "primary source" (soundProfile.source). Unobserved clip/instrument pairs are never scored.
import { readFileSync } from 'node:fs';
import { confidentSoundSummary } from '../src/audio/confidentSoundSummary';
import { evaluateLabels } from '../src/audio/evaluation';

const [split, ...runs] = process.argv.slice(2);
const DOCS = new URL('../docs/evaluations/openmic-exam-2026-10-06/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DOCS), 'utf8'));
const { runtimeLabelMapping } = JSON.parse(readFileSync(new URL('selection.json', DOCS), 'utf8'));
const toClasses = labels => Object.entries(runtimeLabelMapping).filter(([, aliases]) => labels.some(l => aliases.includes(l))).map(([c]) => c);
const ids = new Set(manifest.items.filter(i => i.split === split).map(i => i.id));
export const OUTPUTS = {
  'Sounds panel': a => confidentSoundSummary(a).filter(s => s.dimension === 'source').map(s => s.label),
  'possible list': a => a.instruments.map(i => i.label),
  'primary source': a => a.soundProfile?.source ? [a.soundProfile.source.label] : [],
};
const pct = v => v === null || v === undefined ? '  —  ' : `${(v * 100).toFixed(0).padStart(3)}%`;
const report = {};
for (const run of runs) {
  const [label, path] = run.split('=');
  const byId = new Map(JSON.parse(readFileSync(path, 'utf8')).nodes.map(n => [String(n.path ?? n.title).replace(/\.(wav|ogg)$/, ''), n.audio]));
  const done = [...ids].filter(id => byId.get(id)?.recognition?.status === 'complete');
  report[label] = { split, clips: ids.size, completed: done.length };
  for (const [name, read] of Object.entries(OUTPUTS)) {
    const predictions = done.flatMap(id => toClasses(read(byId.get(id))).map(c => ({ itemId: id, dimension: 'instrument', label: c, decision: 'accepted' })));
    // Clips that did not complete are left out of the exam rather than counted as silent.
    const scored = { ...manifest, items: manifest.items.filter(i => i.split !== split || done.includes(i.id)) };
    const r = evaluateLabels(scored, predictions, split);
    report[label][name] = r;
  }
}
for (const [label, r] of Object.entries(report)) {
  console.log(`\n== ${label}: ${r.completed}/${r.clips} ${split} clips completed`);
  for (const name of Object.keys(OUTPUTS)) {
    const t = r[name].total ?? r[name];
    console.log(`${name.padEnd(15)} precision ${pct(t.precision)}  recall ${pct(t.recall)}  tp ${t.tp} fp ${t.fp} fn ${t.fn}`);
  }
}
console.log(JSON.stringify(report));
