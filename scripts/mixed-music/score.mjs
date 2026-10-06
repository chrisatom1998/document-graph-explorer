// Score the Sounds-panel source tags DGE showed on the frozen mixed-music benchmark.
// Usage: npx vite-node scripts/mixed-music/score.mjs <report.json> <graph-export.json>...
// Uses the app's own display function; only the fixed label mapping below is defined here.
// Only explicit present/absent labels count; unknown pairs are skipped, never treated as absent.
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';

const [outPath, ...exportPaths] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(process.env.MANIFEST ?? 'docs/evaluations/mixed-music-2026-10-05/manifest.json', 'utf8'));
const graph = { nodes: exportPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8')).nodes) };
/** Displayed source label -> benchmark class. Fixed before any scoring. */
const MAP = {
  drums: ['drums', 'drum kit', 'drum machine'], voice: ['voice'], synthesizer: ['synthesizer'], piano: ['piano', 'electric piano'],
  guitar: ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], bass: ['bass guitar', 'bass', 'double bass'],
  cymbals: ['cymbals'], organ: ['organ'], violin: ['violin', 'violin / fiddle'], trumpet: ['trumpet'], saxophone: ['saxophone'],
};
const nodes = new Map(graph.nodes.filter(n => n.audio).map(n => [(n.path ?? n.title).replace(/\.[^.]+$/, ''), n]));
const shown = new Map(), noTag = [], missing = [];
for (const item of manifest.items) {
  const audio = nodes.get(item.id)?.audio;
  if (!audio) { missing.push(item.id); continue; }   // not analysed: left out of every count below, never scored as a miss
  const tags = confidentSoundSummary(audio, audio.recognition?.mode);
  if (!tags.length) noTag.push(item.id);
  shown.set(item.id, new Set(Object.entries(MAP).filter(([, l]) => tags.some(t => t.dimension === 'source' && l.includes(t.label))).map(([c]) => c)));
}
const table = {};
for (const cls of Object.keys(MAP)) {
  const fams = new Map(); let tp = 0, fp = 0, fn = 0, pos = 0, neg = 0;
  for (const item of manifest.items) for (const r of item.reviews) {
    if (r.label !== cls || !shown.has(item.id)) continue;
    const hit = shown.get(item.id).has(cls), f = fams.get(item.groups.artist) ?? [0, 0, 0]; fams.set(item.groups.artist, f);
    if (r.state === 'present') { pos++; if (hit) { tp++; f[0]++; } else { fn++; f[2]++; } }
    else { neg++; if (hit) { fp++; f[1]++; } }
  }
  // Family bootstrap, as in scripts/short-clip-report.py (one clip per artist here, so families are clips).
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const list = [...fams.values()], ps = [], rs = [];
  for (let b = 0; b < 2000 && list.length; b++) {
    let a = 0, c = 0, d = 0;
    for (let i = 0; i < list.length; i++) { const f = list[Math.floor(rand() * list.length)]; a += f[0]; c += f[1]; d += f[2]; }
    if (a + c) ps.push(a / (a + c)); if (a + d) rs.push(a / (a + d));
  }
  const ci = v => v.length >= 1000 ? (v.sort((x, y) => x - y), [v[Math.floor(v.length * .025)], v[Math.min(v.length - 1, Math.floor(v.length * .975))]].map(x => +x.toFixed(3))) : null;
  const P = tp + fp ? tp / (tp + fp) : null, R = pos ? tp / pos : null;
  table[`source:${cls}`] = { precision: P === null ? null : +P.toFixed(3), recall: R === null ? null : +R.toFixed(3), precisionCI95: ci(ps), recallCI95: ci(rs),
    truePositives: tp, falseDetections: fp, misses: fn, positives: pos, negatives: neg };
}
// Why positives were missed: was the label anywhere in the analysis, only under an untested model?
const why = {};
for (const item of manifest.items) for (const r of item.reviews) {
  if (r.state !== 'present' || !shown.has(item.id) || shown.get(item.id).has(r.label)) continue;
  const audio = nodes.get(item.id)?.audio, names = MAP[r.label];
  const inTags = (audio?.soundProfile?.djTags ?? []).filter(t => t.group === 'source' && names.includes(t.label)).map(t => t.model ?? '?');
  const inAst = (audio?.instruments ?? []).some(i => names.includes(i.label));
  const key = inTags.length ? `profile tag (${inTags.join('/')})` : inAst ? 'instrument estimate only' : 'nowhere';
  (why[r.label] ??= {})[key] = (why[r.label]?.[key] ?? 0) + 1;
}
const report = { benchmark: process.env.BENCHMARK ?? 'mixed-music-2026-10-05', items: manifest.items.length, analysed: manifest.items.length - missing.length,
  clipsWithNoScoredTag: noTag.length, missing, missedPositivesFoundIn: why, displayedIncludingMaybe: table };
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`${report.analysed}/${report.items} analysed; ${noTag.length} clips showed no tag`);
for (const [k, v] of Object.entries(table)) console.log(`${k.padEnd(20)} P ${v.precision ?? '—'}  R ${v.recall ?? '—'}  (${v.truePositives} TP / ${v.falseDetections} FP / ${v.misses} FN; ${v.positives} pos, ${v.negatives} neg)`);
console.log('missed positives, where the label was found:', JSON.stringify(why));
