// Score the sound tags DGE shows on a whole-song set: the judge set (docs/evaluations/whole-songs-2026-10-09) or the
// Mixing Secrets tuning set (docs/evaluations/tuning-songs-2026-10-09). Copied from scripts/whole-songs/score.mjs.
// Usage: MANIFEST=<manifest> npx vite-node scripts/tuning-songs/score.mjs <report.json> <graph-export.json>...
// Uses the app's own display function. Truth comes from each song's stems, so a tag left out of a song's `tags` is unknown
// and skipped, never counted as absent. Two views:
//   tags:     every scored catalog tag, shown in any dimension (precision and recall per tag);
//   families: the 12 classes of scripts/holdout-r3/score-tags.mjs (source tags only), to compare with earlier rounds.
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';

const [outPath, ...exportPaths] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(process.env.MANIFEST ?? 'docs/evaluations/whole-songs-2026-10-09/manifest.json', 'utf8'));
const graph = { nodes: exportPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8')).nodes) };
const FAMILY = {   // shown source labels -> class, as in scripts/holdout-r3/score-tags.mjs; truth -> tags that make it present
  drums: [['drums', 'drum kit', 'drum machine'], ['drums']], voice: [['voice'], ['voice']], synthesizer: [['synthesizer'], ['synthesizer']],
  piano: [['piano', 'electric piano'], ['piano', 'electric piano']], guitar: [['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], ['guitar']],
  bass: [['bass guitar', 'bass', 'double bass'], ['bass guitar', 'double bass']], cymbals: [['cymbals'], ['cymbal']], organ: [['organ'], ['organ']],
  violin: [['violin', 'violin / fiddle'], ['violin / fiddle']], trumpet: [['trumpet'], ['trumpet']], saxophone: [['saxophone'], ['saxophone']], cello: [['cello'], ['cello']],
};
const familyTruth = (tags, truth) => truth.some(t => tags[t] === 1) ? 1 : truth.every(t => tags[t] === 0) ? 0 : undefined;
const nodes = new Map(graph.nodes.filter(n => n.audio).map(n => [(n.path ?? n.title).replace(/\.[^.]+$/, ''), n]));
const shown = new Map(), shownSource = new Map(), missing = [], noTag = [];
for (const item of manifest.items) {
  const audio = nodes.get(item.id)?.audio;
  if (!audio) { missing.push(item.id); continue; }   // not analysed: left out of every count, never scored as a miss
  const tags = confidentSoundSummary(audio, audio.recognition?.mode);
  if (!tags.length) noTag.push(item.id);
  shown.set(item.id, new Set(tags.map(t => t.label)));
  shownSource.set(item.id, new Set(tags.filter(t => t.dimension === 'source').map(t => t.label)));
}
function stats(rows) {   // rows: [artist, truth 0/1, hit bool]
  const fams = new Map(); let tp = 0, fp = 0, fn = 0, pos = 0, neg = 0;
  for (const [artist, truth, hit] of rows) {
    const f = fams.get(artist) ?? [0, 0, 0]; fams.set(artist, f);
    if (truth) { pos++; if (hit) { tp++; f[0]++; } else { fn++; f[2]++; } } else { neg++; if (hit) { fp++; f[1]++; } }
  }
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;   // artist bootstrap
  const list = [...fams.values()], ps = [], rs = [];
  for (let b = 0; b < 2000 && list.length; b++) {
    let a = 0, c = 0, d = 0;
    for (let i = 0; i < list.length; i++) { const f = list[Math.floor(rand() * list.length)]; a += f[0]; c += f[1]; d += f[2]; }
    if (a + c) ps.push(a / (a + c)); if (a + d) rs.push(a / (a + d));
  }
  const ci = v => v.length >= 1000 ? (v.sort((x, y) => x - y), [v[Math.floor(v.length * .025)], v[Math.min(v.length - 1, Math.floor(v.length * .975))]].map(x => +x.toFixed(3))) : null;
  const P = tp + fp ? tp / (tp + fp) : null, R = pos ? tp / pos : null, r3 = x => x === null ? null : +x.toFixed(3);
  return { precision: r3(P), recall: r3(R), precisionCI95: ci(ps), recallCI95: ci(rs), truePositives: tp, falseDetections: fp, misses: fn,
    positives: pos, negatives: neg, falseAlarmRate: neg ? r3(fp / neg) : null, pass70: P !== null && R !== null && P >= .7 && R >= .7 };
}
const scored = manifest.items.filter(i => shown.has(i.id));
const tags = {}, families = {};
for (const t of manifest.scored) {
  const rows = scored.filter(i => i.tags[t] !== undefined).map(i => [i.groups.artist, i.tags[t], shown.get(i.id).has(t)]);
  if (rows.length) tags[t] = stats(rows);
}
for (const [cls, [labels, truth]] of Object.entries(FAMILY)) {
  const rows = scored.map(i => [i, familyTruth(i.tags, truth)]).filter(([, v]) => v !== undefined)
    .map(([i, v]) => [i.groups.artist, v, labels.some(l => shownSource.get(i.id).has(l))]);
  families[cls] = stats(rows);
}
// Tags shown that the set can't judge (no truth for them on any song), with how often: worth labelling next.
const unjudged = {};
for (const i of scored) for (const t of shown.get(i.id)) if (i.tags[t] === undefined) unjudged[t] = (unjudged[t] ?? 0) + 1;
const report = { benchmark: manifest.kind ?? 'whole-songs-2026-10-09', songs: manifest.items.length, analysed: scored.length, missing, noTag: noTag.length,
  passing70: Object.entries(tags).filter(([, s]) => s.pass70).map(([t]) => t), families, tags,
  shownButUnjudged: Object.fromEntries(Object.entries(unjudged).sort((a, b) => b[1] - a[1])) };
writeFileSync(outPath, JSON.stringify(report, null, 1));
const f = x => x === null ? '  -  ' : x.toFixed(2);
console.log(`${scored.length}/${manifest.items.length} songs analysed, ${noTag.length} with no tag shown`);
console.log('families (source tags):'); for (const [c, s] of Object.entries(families)) console.log(`  ${c.padEnd(12)} P ${f(s.precision)} R ${f(s.recall)}  (${s.positives}+/${s.negatives}-)${s.pass70 ? '  pass' : ''}`);
console.log('tags with positives:');
for (const [t, s] of Object.entries(tags).sort((a, b) => b[1].positives - a[1].positives)) if (s.positives)
  console.log(`  ${t.padEnd(18)} P ${f(s.precision)} R ${f(s.recall)}  (${s.positives}+/${s.negatives}-)${s.pass70 ? '  pass' : ''}`);
console.log('false alarms on tags no song has:', Object.entries(tags).filter(([, s]) => !s.positives && s.falseDetections).map(([t, s]) => `${t} ${s.falseDetections}/${s.negatives}`).join(', ') || 'none');
