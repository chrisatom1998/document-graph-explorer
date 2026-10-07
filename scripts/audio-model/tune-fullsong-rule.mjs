// Pick the trained tagger's long-recording rule per instrument on the full-song tuning set (never on a held-out set).
// Usage: MANIFEST=docs/evaluations/all-tags-model-2026-10-06/fullsong-tuning-manifest.json \
//          npx vite-node scripts/audio-model/tune-fullsong-rule.mjs <report.json> <graph-export.json>...
// The exports must come from a build that stores the tagger's per-window scores (TaggerAnalysis.windowScores).
// Scoring is scripts/holdout-r3/score-tags.mjs's: the app's own display function, the same label map, weak view
// (untagged counts as absent). For each instrument the tagger decides, every candidate rule is applied to that tag only
// and scored; "detectors" is main's behaviour for the tag (the tagger leaves it to the existing detectors). The rule
// chosen keeps precision at or above main's and has the highest recall (ties: higher precision, then the simpler rule,
// then the lower threshold).
// Only aggregates are written.
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';
import { TAGGER_POLICY } from '../../src/audio/tagger';

const [outPath, ...exportPaths] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(process.env.MANIFEST, 'utf8'));
const MAP = {
  drums: ['drums', 'drum kit', 'drum machine'], voice: ['voice'], synthesizer: ['synthesizer'], piano: ['piano', 'electric piano'],
  guitar: ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], bass: ['bass guitar', 'bass', 'double bass'],
  cymbals: ['cymbals'], organ: ['organ'], violin: ['violin', 'violin / fiddle'], trumpet: ['trumpet'], saxophone: ['saxophone'], cello: ['cello'],
};
const nodes = new Map(exportPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8')).nodes).filter(n => n.audio)
  .map(n => [(n.path ?? n.title).replace(/\.[^.]+$/, ''), n.audio]));
const items = manifest.items.filter(it => nodes.has(it.id));
const long = items.filter(it => (nodes.get(it.id).tagger?.windows ?? 0) > 1);
if (long.length !== items.length) throw new Error(`${items.length - long.length} analysed tracks have no multi-window tagger result`);

function score(cls) {
  let tp = 0, fp = 0, pos = 0;
  for (const it of items) {
    const audio = nodes.get(it.id);
    const hit = confidentSoundSummary(audio, audio.recognition?.mode).some(t => t.dimension === 'source' && MAP[cls].includes(t.label));
    for (const r of it.reviews) if (r.label === cls) {
      if (r.state === 'present') { pos++; if (hit) tp++; } else if (hit) fp++;
    }
  }
  return { precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, recall: pos ? +(tp / pos).toFixed(3) : null, truePositives: tp, falseDetections: fp, positives: pos };
}
const FRACTIONS = [0.2, 0.4, 0.6, 0.8];
const report = { manifest: process.env.MANIFEST, items: manifest.items.length, analysed: items.length, tags: {} };
for (const tag of TAGGER_POLICY.tags.filter(t => t.dimension === 'source')) {
  const cls = Object.keys(MAP).find(c => MAP[c].includes(tag.label));
  const saved = tag.long;
  const raise = f => +(tag.threshold + (1 - tag.threshold) * f).toFixed(4);
  const candidates = [{ rule: 'detectors' }, { rule: 'max' }, { rule: 'windows', windows: 2 }, { rule: 'windows', windows: 3 }, { rule: 'mean' }, { rule: 'agree' },
    ...['max', 'windows', 'mean'].flatMap(rule => FRACTIONS.map(f => ({ rule, ...(rule === 'windows' ? { windows: 2 } : {}), threshold: raise(f) })))];
  const rows = candidates.map(c => { tag.long = c; return { rule: c, ...score(cls) }; });
  tag.long = saved;
  const main = rows[0], current = rows[1];
  const ok = rows.filter(r => r.precision !== null && main.precision !== null && r.precision >= main.precision);
  // Highest recall, then highest precision; remaining ties keep the earlier (simpler, lower-threshold) candidate.
  const chosen = ok.length ? ok.reduce((a, b) => (b.recall > a.recall || (b.recall === a.recall && b.precision > a.precision) ? b : a)) : main;
  const installed = (() => { tag.long = saved; return score(cls); })();
  report.tags[tag.output] = { class: cls, positives: main.positives, main, current, chosen, installed: { rule: saved ?? { rule: 'max' }, ...installed }, candidates: rows };
  const f = r => `P ${r.precision ?? '—'} R ${r.recall ?? '—'} (${r.truePositives} TP / ${r.falseDetections} FP)`;
  console.log(`${tag.output.padEnd(10)} main ${f(main)} | max ${f(current)} | chosen ${JSON.stringify(chosen.rule)} ${f(chosen)} | installed ${f(installed)}`);
}
writeFileSync(outPath, JSON.stringify(report, null, 1));
