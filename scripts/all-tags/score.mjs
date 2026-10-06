// Score every app tag the all-tags MTG-Jamendo set labels, using the app's own display function.
// Usage: MANIFEST=<manifest> HALF=pick|check|all npx vite-node scripts/all-tags/score.mjs <report.json> <graph-export.json>...
// Recall counts labelled-present items the app missed. On Jamendo, precision counts untagged tracks as absent, and
// uploaders under-tag, so it is a floor. On TinySOL every absent is real (precisionIsExact). Only explicit labels count; nothing is inferred.
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';

const [outPath, ...exportPaths] = process.argv.slice(2);
const half = process.env.HALF ?? 'all';
const manifest = JSON.parse(readFileSync(process.env.MANIFEST, 'utf8'));
const items = manifest.items.filter(i => half === 'all' || i.half === half);
/** Manifest tag -> shown labels that count as that tag (any dimension). Fixed before any scoring. */
const MAP = {
  drums: ['drums', 'drum kit', 'drum machine'], voice: ['voice', 'singing'], synthesizer: ['synthesizer'], piano: ['piano'],
  'electric piano': ['electric piano'], guitar: ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'],
  'acoustic guitar': ['acoustic guitar', 'steel guitar'], 'electric guitar': ['electric guitar'], 'bass guitar': ['bass guitar', 'bass', 'double bass'],
  organ: ['organ'], 'violin / fiddle': ['violin / fiddle', 'violin', 'fiddle'], cello: ['cello'], strings: ['strings', 'string section'],
  trumpet: ['trumpet'], trombone: ['trombone'], horn: ['horn', 'french horn'], saxophone: ['saxophone'], clarinet: ['clarinet'], oboe: ['oboe'],
  flute: ['flute'], bassoon: ['bassoon'], harp: ['harp'], accordion: ['accordion'], harmonica: ['harmonica'], 'atmospheric pad': ['atmospheric pad'],
  'chiptune synth': ['chiptune synth'], choir: ['choir'],
};
const nodes = new Map(exportPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8')).nodes).filter(n => n.audio)
  .map(n => [(n.path ?? n.title).replace(/\.[^.]+$/, ''), n]));
const shown = new Map(), missing = [];
for (const item of items) {
  const audio = nodes.get(item.id)?.audio;
  if (!audio) { missing.push(item.id); continue; }   // not analysed: left out of every count, never scored as a miss
  const labels = confidentSoundSummary(audio, audio.recognition?.mode).map(t => t.label);
  shown.set(item.id, new Set(Object.keys(MAP).filter(tag => MAP[tag].some(l => labels.includes(l)))));
}
const table = {};
for (const tag of Object.keys(MAP)) {
  let tp = 0, fp = 0, fn = 0, pos = 0, neg = 0, strongNeg = 0;
  const fams = new Map();
  for (const item of items) for (const r of item.reviews) {
    if (r.label !== tag || !shown.has(item.id)) continue;
    const hit = shown.get(item.id).has(tag), f = fams.get(item.groups.artist) ?? [0, 0, 0]; fams.set(item.groups.artist, f);
    if (r.state === 'present') { pos++; if (hit) { tp++; f[0]++; } else { fn++; f[2]++; } }
    else { neg++; if (!r.weak) strongNeg++; if (hit) { fp++; f[1]++; } }
  }
  // Artist bootstrap for 95% intervals (artists are the dependence unit: up to three tracks each).
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const list = [...fams.values()], ps = [], rs = [];
  for (let b = 0; b < 2000 && list.length; b++) {
    let a = 0, c = 0, d = 0;
    for (let i = 0; i < list.length; i++) { const f = list[Math.floor(rand() * list.length)]; a += f[0]; c += f[1]; d += f[2]; }
    if (a + c) ps.push(a / (a + c)); if (a + d) rs.push(a / (a + d));
  }
  const ci = v => v.length >= 1000 ? (v.sort((x, y) => x - y), [v[Math.floor(v.length * .025)], v[Math.min(v.length - 1, Math.floor(v.length * .975))]].map(x => +x.toFixed(3))) : null;
  const P = tp + fp ? tp / (tp + fp) : null, R = pos ? tp / pos : null;
  table[tag] = { recall: R === null ? null : +R.toFixed(3), recallCI95: ci(rs), precisionFloor: P === null ? null : +P.toFixed(3), precisionFloorCI95: ci(ps),
    precisionIsExact: neg > 0 && strongNeg === neg, truePositives: tp, untaggedButShown: fp, misses: fn, positives: pos, untagged: neg, strongAbsents: strongNeg };
}
const report = { benchmark: process.env.BENCHMARK ?? 'all-tags-2026-10-06/jamendo-val', half, items: items.length, analysed: items.length - missing.length, missing, tags: table };
writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`${half}: ${report.analysed}/${report.items} analysed`);
for (const [k, v] of Object.entries(table)) console.log(`${k.padEnd(18)} R ${v.recall ?? '—'}  P>= ${v.precisionFloor ?? '—'}  (${v.truePositives} TP / ${v.untaggedButShown} shown untagged / ${v.misses} missed; ${v.positives} tagged)`);
