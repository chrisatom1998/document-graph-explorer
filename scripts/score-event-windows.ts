/* Scores the shipped one-shot detectors (public/sound-model/short-clip.json) on short windows cut at each
 * sound's start inside the held-out drum-loop mixes (cut-event-windows.py), at each head's own threshold.
 * Also reports the long-audio heads (learned.json) on the same windows, and how often drum one-shot heads fire
 * (every window has a drum loop under it, so those are expected).
 * Usage: npx vite-node scripts/score-event-windows.ts <windows test.json> <fingerprint dir> <out.json> */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { sanitizeShortClipModel, shortClipScores } from '../src/audio/shortClipModel';
import { sanitizeLearnedDjModel } from '../src/audio/learnedDjModel';

const [MANIFEST, DIR, OUT] = process.argv.slice(2);
const clips: { id: string; labels: string[]; levelDb: number }[] = JSON.parse(readFileSync(MANIFEST, 'utf8')).clips;
const emb = new Map<string, number[]>();
for (const f of readdirSync(DIR).filter(f => /^emb-.*\.jsonl$/.test(f)))
  for (const line of readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) if (line) { const r = JSON.parse(line); emb.set(r.id, r.embedding); }
const rows = clips.filter(c => emb.has(c.id));
const short = sanitizeShortClipModel(JSON.parse(readFileSync('public/sound-model/short-clip.json', 'utf8')))!;
const learned = sanitizeLearnedDjModel(JSON.parse(readFileSync('public/sound-model/learned.json', 'utf8')))!;

// Which mixture target labels make each detector label true.
const SYNTH = ['synth stab', 'synth pluck', 'synth chord', 'synth lead', 'synth bass', 'synth sequence', 'synth arpeggio', 'bell synth', 'brass synth', 'organ synth', 'string synth', 'atmospheric pad'];
const TRUTH: Record<string, string[]> = { impact: ['impact'], whoosh: ['whoosh'], 'vinyl scratch': ['vinyl scratch'],
  'synth hit': ['synth stab', 'synth pluck', 'synth chord'], synthesizer: SYNTH, 'reverse effect': ['reverse effect'], 'ambient drone': ['ambient drone'] };
const DRUMS = ['kick', 'snare', 'hi-hat', 'cymbal', 'clap', 'drums', 'shaker', 'percussion hit'];

const unit = (v: number[]) => { const n = Math.hypot(...v) + 1e-9; return v.map(x => x / n); };
const learnedFires = (v: number[]) => {
  const x = unit(v); const out = new Set<string>();
  for (const h of learned.heads ?? []) { const z = h.bias + h.weights.reduce((s, w, i) => s + w * x[i], 0); if (1 / (1 + Math.exp(-z)) >= h.threshold) out.add(h.label); }
  return out;
};
const fired = rows.map(c => {
  const s = new Set(shortClipScores(short, { clapRepeat: emb.get(c.id)! }).scores.map(x => x.label));
  return { c, short: s, long: learnedFires(emb.get(c.id)!) };
});
const report: Record<string, unknown> = { windows: rows.length, shortClipRevision: short.revision, learnedRevision: learned.revision, labels: {} };
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);
console.log(`${rows.length} windows\n${'label'.padEnd(16)}${'pos'.padStart(5)}  one-shot heads (precision / recall / buried recall)   long heads on same window`);
for (const [label, truth] of Object.entries(TRUTH)) {
  const t = fired.map(f => f.c.labels.some(l => truth.includes(l)));
  const score = (which: 'short' | 'long') => {
    const p = fired.map(f => f[which].has(label)); const tp = p.filter((v, i) => v && t[i]).length; const fp = p.filter((v, i) => v && !t[i]).length;
    const buried = fired.map((f, i) => t[i] && f.c.levelDb < -3); const bt = buried.filter(Boolean).length;
    return { available: (which === 'short' ? short.heads : learned.heads ?? []).some(h => h.label === label), tp, fp, precision: tp / Math.max(tp + fp, 1),
      recall: tp / Math.max(t.filter(Boolean).length, 1), buriedRecall: p.filter((v, i) => v && buried[i]).length / Math.max(bt, 1) };
  };
  const s = score('short'), l = score('long');
  (report.labels as Record<string, unknown>)[label] = { positive: t.filter(Boolean).length, oneShot: s, longHeads: l };
  const show = (r: typeof s) => r.available ? `${pct(r.precision)} / ${pct(r.recall)} / ${pct(r.buriedRecall)}` : '     no head      ';
  console.log(`${label.padEnd(16)}${String(t.filter(Boolean).length).padStart(5)}  ${show(s).padEnd(46)}${show(l)}`);
}
const drumRate = Object.fromEntries(DRUMS.map(d => [d, fired.filter(f => f.short.has(d)).length / fired.length]));
report.drumHeadFireRate = drumRate;
console.log('\ndrum one-shot heads firing on these windows (a drum loop is always underneath):',
  Object.entries(drumRate).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n');
