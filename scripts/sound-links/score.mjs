// Scores the links the real app made between benchmark clips (graph export from scripts/short-clip-upload-eval.mjs).
// Usage: node scripts/sound-links/score.mjs <manifest.json> <graph-export.json> <label> [out.json]
// A link is "right" when both clips share the ground-truth label (songs: FMA genre or artist; notes: instrument
// family or instrument). Clip names are opaque ids, so no link can come from a file name here.
import { readFileSync, writeFileSync } from 'node:fs';

const [manifestPath, exportPath, name, outPath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const graph = JSON.parse(readFileSync(exportPath, 'utf8'));
const relations = manifest.kind === 'songs' ? ['genre', 'artist'] : ['family', 'instrument'];
const byFile = new Map(manifest.items.map(i => [i.path.split('/').pop(), i]));
const clip = new Map(graph.nodes.flatMap(n => { const i = byFile.get((n.path ?? n.title).split('/').pop()); return i ? [[n.id, i]] : []; }));
const analysed = [...clip.keys()].filter(id => graph.nodes.find(n => n.id === id)?.audio?.stage !== 'preview').length;
const edges = graph.edges.filter(e => clip.has(e.source) && clip.has(e.target));
const pct = x => Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : '–';
const same = (e, r) => clip.get(e.source).labels[r] === clip.get(e.target).labels[r];
const row = list => {
  const out = { links: list.length, clipsLinked: new Set(list.flatMap(e => [e.source, e.target])).size / clip.size };
  for (const r of relations) out[r] = list.length ? list.filter(e => same(e, r)).length / list.length : NaN;
  return out;
};
const ids = [...clip.values()];
const base = Object.fromEntries(relations.map(r => {
  let s = 0, all = 0;
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) { all++; if (ids[a].labels[r] === ids[b].labels[r]) s++; }
  return [r, s / all];
}));
// One row per linked pair, whatever the kinds, plus one row per kind.
const pairs = [...new Map(edges.map(e => [`${e.source}|${e.target}`, e])).values()];
const kinds = [...new Set(edges.map(e => e.kind))].sort();
const result = { name, clips: clip.size, analysed, baseRates: base, all: row(pairs), kinds: Object.fromEntries(kinds.map(k => [k, row(edges.filter(e => e.kind === k))])) };
const show = e => `${clip.get(e.source).labels[relations[0]]} ↔ ${clip.get(e.target).labels[relations[0]]} (${e.kind}): ${e.evidence[0]}`;
result.examples = { right: edges.filter(e => same(e, relations[0])).slice(0, 6).map(show), wrong: edges.filter(e => !same(e, relations[0])).slice(0, 6).map(show) };
console.log(`\n### ${name}: ${manifest.kind}, ${clip.size} clips (${analysed} analysed). Random pair: ${relations.map(r => `same ${r} ${pct(base[r])}`).join(', ')}`);
console.log(`| links | count | clips linked | ${relations.map(r => `same ${r}`).join(' | ')} |`);
console.log(`|---|---|---|${relations.map(() => '---').join('|')}|`);
for (const [k, r] of [['all pairs', result.all], ...Object.entries(result.kinds)]) console.log(`| ${k} | ${r.links} | ${pct(r.clipsLinked)} | ${relations.map(x => pct(r[x])).join(' | ')} |`);
console.log('\nExamples (right):'); for (const e of result.examples.right) console.log(`- ${e}`);
console.log('Examples (wrong):'); for (const e of result.examples.wrong) console.log(`- ${e}`);
if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 1));
