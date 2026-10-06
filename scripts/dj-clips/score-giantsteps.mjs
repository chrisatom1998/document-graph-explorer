// Score DGE's tempo on the GiantSteps EDM excerpts and list the sound tags it showed on them (no tag truth exists).
// Usage: npx vite-node scripts/dj-clips/score-giantsteps.mjs <report.json> <graph-export.json>...
// Tempo is "shown" whenever the analysis has one (the Music panel prints it); "confident" is confidence >= 0.5, the bar
// tempo links use. Accuracy 1: within 4% of the v2 tempo. Accuracy 2: also counts 2x, 1/2x, 3x, 1/3x (octave errors).
// Key (only for manifests whose items carry a single annotated key, e.g. round 2's MTG key set): exact match and the
// MIREX weighted score, over clips whose key annotation has the annotators' top confidence (2).
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';
import { scoreKey } from '../../src/audio/evaluationSignals';

const [outPath, ...exportPaths] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(process.env.MANIFEST ?? 'docs/evaluations/dj-clips-2026-10-06/giantsteps-manifest.json', 'utf8'));
const nodes = new Map(exportPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8')).nodes).filter(n => n.audio)
  .map(n => [(n.path ?? n.title).replace(/\.[^.]+$/, ''), n]));
const near = (a, b) => Math.abs(a - b) <= 0.04 * b;
const blank = () => ({ clips: 0, tempoClips: 0, tempoShown: 0, acc1: 0, acc2: 0, t1OrT2: 0, half: 0, double: 0, other: 0, confident: 0, confidentAcc1: 0, confidentAcc2: 0, noTag: 0, tags: {}, keyScored: 0, keyShown: 0, keyExact: 0, keyWeighted: 0, keyFifth: 0, keyRelative: 0, keyParallel: 0 });
const groups = { all: blank() }, missing = [], rows = [];
for (const item of manifest.items) {
  const audio = nodes.get(item.id)?.audio;
  if (!audio) { missing.push(item.id); continue; }
  const truth = item.tempo.bpm, est = audio.tempo?.bpm, conf = audio.tempo?.confidence ?? 0;
  const tags = confidentSoundSummary(audio, audio.recognition?.mode).map(t => `${t.dimension}:${t.label}`);
  const a1 = truth > 0 ? est != null && near(est, truth) : null, a2 = truth > 0 ? est != null && [1, 2, .5, 3, 1 / 3].some(f => near(est, truth * f)) : null;
  rows.push({ id: item.id, genre: item.genre, truth, t1: item.tempo.t1, t2: item.tempo.t2, estimate: est ?? null, confidence: est != null ? +conf.toFixed(3) : null,
    alternatives: audio.tempo?.alternatives ?? [], acc1: a1, acc2: a2, tags });
  const refKey = item.key?.tonic != null && item.key.confidence === 2 ? { tonic: item.key.tonic, mode: item.key.mode } : null;
  const estKey = audio.key && audio.key.source !== 'filename' ? { tonic: audio.key.tonic, mode: audio.key.mode } : null;
  const ks = refKey ? scoreKey(refKey, estKey) : null;
  if (item.key) Object.assign(rows.at(-1), { keyTruth: item.key.label ?? null, keyConfidence: item.key.confidence ?? null,
    keyEstimate: estKey ? `${estKey.tonic}:${estKey.mode}` : null, keyStrength: audio.key?.strength ?? null, keyScore: ks?.weighted ?? null });
  for (const g of [groups.all, groups[item.genre] ??= blank()]) {
    g.clips++;
    if (!tags.length) g.noTag++;
    if (ks) {
      g.keyScored++; if (estKey) g.keyShown++; if (ks.exact) g.keyExact++; g.keyWeighted += ks.weighted;
      if (ks.weighted === .5) g.keyFifth++; else if (ks.weighted === .3) g.keyRelative++; else if (ks.weighted === .2) g.keyParallel++;
    }
    for (const t of tags) g.tags[t] = (g.tags[t] ?? 0) + 1;
    if (!(truth > 0)) continue;   // some Beatport rows list 0 BPM: no tempo truth, so no tempo score
    g.tempoClips++;
    if (est == null) continue;
    g.tempoShown++; if (a1) g.acc1++; if (a2) g.acc2++;
    if (near(est, item.tempo.t1) || (item.tempo.t2 > 0 && near(est, item.tempo.t2))) g.t1OrT2++;
    if (!a1) { if (near(est, truth / 2)) g.half++; else if (near(est, truth * 2)) g.double++; else g.other++; }
    if (conf >= .5) { g.confident++; if (a1) g.confidentAcc1++; if (a2) g.confidentAcc2++; }
  }
}
const pct = (a, b) => b ? +(a / b).toFixed(3) : null;
const summary = Object.fromEntries(Object.entries(groups).sort((a, b) => b[1].clips - a[1].clips).map(([k, g]) => [k, {
  ...g, tags: Object.fromEntries(Object.entries(g.tags).sort((a, b) => b[1] - a[1])),
  coverage: pct(g.tempoShown, g.tempoClips), acc1OfAll: pct(g.acc1, g.tempoClips), acc2OfAll: pct(g.acc2, g.tempoClips), acc1OfShown: pct(g.acc1, g.tempoShown),
  acc2OfShown: pct(g.acc2, g.tempoShown), confidentCoverage: pct(g.confident, g.tempoClips), confidentAcc1: pct(g.confidentAcc1, g.confident), confidentAcc2: pct(g.confidentAcc2, g.confident),
  keyCoverage: pct(g.keyShown, g.keyScored), keyExactRate: pct(g.keyExact, g.keyScored), keyExactOfShown: pct(g.keyExact, g.keyShown), keyMirex: pct(g.keyWeighted, g.keyScored) }]));
writeFileSync(outPath, JSON.stringify({ benchmark: process.env.BENCHMARK ?? 'dj-clips-2026-10-06/giantsteps', items: manifest.items.length, analysed: rows.length, missing, summary, rows }, null, 1));
console.log(`${rows.length}/${manifest.items.length} analysed`);
for (const [k, g] of Object.entries(summary)) console.log(`${k.padEnd(24)} n ${String(g.clips).padStart(3)}  tempo n ${g.tempoClips}  shown ${g.coverage}  acc1 ${g.acc1OfAll} (of shown ${g.acc1OfShown})  acc2 ${g.acc2OfAll}  half ${g.half} double ${g.double} other ${g.other}  confident ${g.confidentCoverage} acc1 ${g.confidentAcc1}  no tag ${g.noTag}${g.keyScored ? `  key n ${g.keyScored} shown ${g.keyShown} exact ${g.keyExactRate} mirex ${g.keyMirex} (fifth ${g.keyFifth} relative ${g.keyRelative} parallel ${g.keyParallel})` : ''}`);
console.log('tags shown (all):', JSON.stringify(summary.all.tags));
