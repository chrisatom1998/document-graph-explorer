// Score what DGE showed on the free sample packs (docs/evaluations/sample-packs-2026-10-06) against the packs' own names.
// Usage: MANIFEST=... [FILE_FIELD=file|originalName] npx vite-node scripts/sample-packs/score.mjs <report.json> <graph-export.json>...
// Tags use the app's own display function (the Sounds panel); the label mapping below is fixed before scoring.
// Pass bar: precision and recall >= 0.70 per label; tempo and key accuracy >= 0.70. Unknown labels are never scored.
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';
import { musicNameHints } from '../../src/audio/nameHints';
import { DJ_TYPE_SOURCE } from '../../src/audio/djTags';

const BAR = 0.7;
const [outPath, ...exportPaths] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(process.env.MANIFEST ?? 'docs/evaluations/sample-packs-2026-10-06/manifest.json', 'utf8'));
const field = process.env.FILE_FIELD ?? 'file';
const nodes = new Map(exportPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8')).nodes).map(n => [(n.path ?? n.title).split(/[\\/]/).pop(), n]));

const BASS = ['bass hit', 'sub bass', 'reese bass', 'wobble bass', 'bass growl', 'acid bass', '808 bass', 'bass pluck', 'foghorn bass', 'rubbery bass', 'synth bass'];
const VOCAL = ['vocal chops', 'chops', 'vocal phrase', 'spoken phrase', 'whisper', 'vocal shout', 'vocal chant', 'vocal ad-lib', 'vocal hum', 'vocal vowel', 'choir',
  'vocal harmony', 'vocal scream', 'vocal laugh', 'vocal gasp', 'vocoder vocal', 'pitched vocal', 'reversed vocal', 'vocal pad', 'vocal breath', 'vocal shush'];
const HITS = ['kick', 'snare', 'clap', 'closed hi-hat', 'open hi-hat', 'ride cymbal', 'crash cymbal', 'rimshot', 'tom', 'shaker', 'tambourine', 'conga', 'bongo',
  'cowbell', 'clave', 'woodblock', 'finger snap', 'percussion hit', 'hi-hat', 'cymbal'];
const SYNTH = Object.entries(DJ_TYPE_SOURCE).filter(([, s]) => s === 'synthesizer').map(([l]) => l);
/** Benchmark label -> displayed (dimension, labels). Any dimension other than 'source' means the effect/role tag lists. */
const MAP = {
  drums: [['source', ['drums', 'percussion', 'hand percussion', 'drum kit', 'drum machine']]],
  kick: [['effect', ['kick']]], snare: [['effect', ['snare', 'rimshot']]], 'hi-hat': [['effect', ['hi-hat', 'closed hi-hat', 'open hi-hat']]],
  clap: [['effect', ['clap']]], cowbell: [['effect', ['cowbell']]], cymbal: [['effect', ['cymbal', 'crash cymbal', 'ride cymbal']]],
  'percussion hit': [['effect', HITS]],
  bass: [['source', ['bass guitar', 'bass', 'double bass']], ['effect', BASS]],
  synthesizer: [['source', ['synthesizer']], ['effect', SYNTH]],
  guitar: [['source', ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar']]],
  piano: [['source', ['piano', 'electric piano']]],
  voice: [['source', ['voice']], ['effect', VOCAL]],
};
const near = (a, b) => Math.abs(a - b) <= 0.04 * b;
const pct = (a, b) => b ? +(a / b).toFixed(3) : null;
const rows = [], missing = [];
for (const item of manifest.items) {
  const node = nodes.get(item[field]);
  const audio = node?.audio;
  if (!audio) { missing.push({ id: item.id, name: item[field], pack: item.pack, transformation: item.transformation, format: item.format, node: !!node, status: node?.status ?? null }); continue; }
  const tags = confidentSoundSummary(audio, audio.recognition?.mode);
  const shown = {};
  for (const [label, rules] of Object.entries(MAP)) {
    const hits = tags.filter(t => rules.some(([dim, ls]) => (dim === 'source' ? t.dimension === 'source' : t.dimension !== 'source') && ls.includes(t.label)));
    if (hits.length) shown[label] = hits.every(t => t.maybe) ? 'maybe' : 'shown';
  }
  const hints = field === 'file' ? {} : musicNameHints(node);
  const tempo = hints.tempo ? { bpm: hints.tempo.value, confidence: 1, from: 'name' } : audio.tempo ? { ...audio.tempo, from: 'audio' } : null;
  const key = hints.key ? { ...hints.key.value, from: 'name' } : audio.key ? { ...audio.key, from: 'audio' } : null;
  rows.push({ id: item.id, name: item[field], pack: item.pack, kind: item.kind, transformation: item.transformation, format: item.format,
    status: audio.recognition?.status ?? null, failedJobs: (audio.recognition?.jobs ?? []).filter(j => j.status === 'failed' || j.unsupportedReason).map(j => `${j.modelId}:${j.unsupportedReason ?? j.status}`),
    notes: audio.notes ?? [], durationSeconds: audio.durationSeconds, truth: { tempo: item.tempo, key: item.key, labels: item.labels },
    tempo, key, pitch: audio.detectedPitch ?? null, shown, displayed: tags.map(t => `${t.dimension}:${t.label}${t.maybe ? '?' : ''}`) });
}

function tagTable(subset, withMaybe) {
  const out = {};
  for (const label of Object.keys(MAP)) {
    let tp = 0, fp = 0, fn = 0, pos = 0, neg = 0;
    for (const r of subset) {
      const truth = r.truth.labels[label]; if (!truth) continue;
      const hit = withMaybe ? !!r.shown[label] : r.shown[label] === 'shown';
      if (truth === 'present') { pos++; hit ? tp++ : fn++; } else { neg++; if (hit) fp++; }
    }
    if (!pos && !neg) continue;
    const P = tp + fp ? tp / (tp + fp) : null, R = pos ? tp / pos : null;
    out[label] = { precision: P === null ? null : +P.toFixed(3), recall: R === null ? null : +R.toFixed(3), tp, fp, fn, positives: pos, negatives: neg,
      pass: P !== null && R !== null && P >= BAR && R >= BAR };
  }
  return out;
}
function tempoTable(subset) {
  const t = subset.filter(r => r.truth.tempo);
  const shown = t.filter(r => r.tempo), a1 = shown.filter(r => near(r.tempo.bpm, r.truth.tempo)), a2 = shown.filter(r => [1, 2, .5, 1.5, 2 / 3, 3, 1 / 3].some(f => near(r.tempo.bpm, r.truth.tempo * f)));
  const conf = shown.filter(r => r.tempo.confidence >= .5);
  return { items: t.length, shown: shown.length, acc1OfAll: pct(a1.length, t.length), acc2OfAll: pct(a2.length, t.length), acc1OfShown: pct(a1.length, shown.length),
    confident: conf.length, confidentAcc1: pct(conf.filter(r => near(r.tempo.bpm, r.truth.tempo)).length, conf.length),
    half: shown.filter(r => near(r.tempo.bpm, r.truth.tempo / 2)).length, double: shown.filter(r => near(r.tempo.bpm, r.truth.tempo * 2)).length,
    pass: t.length ? a1.length / t.length >= BAR : null };
}
function keyTable(subset) {
  const mm = subset.filter(r => r.truth.key && ['major', 'minor'].includes(r.truth.key.mode));
  const modal = subset.filter(r => r.truth.key && !['major', 'minor'].includes(r.truth.key.mode));
  const rel = (k, t) => k.mode !== t.mode && (k.mode === 'major' ? (k.tonic + 9) % 12 === t.tonic : (t.tonic + 9) % 12 === k.tonic);
  const shown = mm.filter(r => r.key), exact = shown.filter(r => r.key.tonic === r.truth.key.tonic && r.key.mode === r.truth.key.mode);
  const strong = shown.filter(r => r.key.strength === undefined || r.key.strength >= .6);
  return { majorMinorItems: mm.length, shown: shown.length, exactOfAll: pct(exact.length, mm.length), exactOfShown: pct(exact.length, shown.length),
    tonicOfAll: pct(shown.filter(r => r.key.tonic === r.truth.key.tonic).length, mm.length), relative: shown.filter(r => rel(r.key, r.truth.key)).length,
    fifth: shown.filter(r => r.key.mode === r.truth.key.mode && [5, 7].includes((r.key.tonic - r.truth.key.tonic + 12) % 12)).length,
    linkStrength: strong.length, linkStrengthExact: pct(strong.filter(r => r.key.tonic === r.truth.key.tonic && r.key.mode === r.truth.key.mode).length, strong.length),
    modalItems: modal.length, modalTonicOfAll: pct(modal.filter(r => r.key && r.key.tonic === r.truth.key.tonic).length, modal.length),
    pass: mm.length ? exact.length / mm.length >= BAR : null };
}
const groups = { all: rows };
for (const r of rows) (groups[`pack: ${r.pack}`] ??= []).push(r);
for (const r of rows) if (r.pack === 'Transmutation') (groups[`kind: ${r.kind}`] ??= []).push(r);
const summary = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, { items: g.length, noTag: g.filter(r => !r.displayed.length).length,
  tags: tagTable(g, false), tagsWithMaybe: tagTable(g, true), tempo: tempoTable(g), key: keyTable(g) }]));
const errors = { notAnalysed: missing, failedOrPartial: rows.filter(r => r.status !== 'complete' || r.failedJobs.length).map(r => ({ id: r.id, name: r.name, transformation: r.transformation, format: r.format, status: r.status, failedJobs: r.failedJobs, notes: r.notes })),
  formatChecks: rows.filter(r => r.pack === 'Format checks').map(r => ({ transformation: r.transformation, status: r.status, failedJobs: r.failedJobs, duration: r.durationSeconds, tempo: r.tempo?.bpm ?? null, truthTempo: r.truth.tempo, displayed: r.displayed })) };
writeFileSync(outPath, JSON.stringify({ benchmark: 'sample-packs-2026-10-06', fileField: field, bar: BAR, items: manifest.items.length, analysed: rows.length, summary, errors, rows }, null, 1));
console.log(`${rows.length}/${manifest.items.length} analysed (${field}); ${missing.length} not analysed; ${errors.failedOrPartial.length} failed or partial`);
for (const [k, s] of Object.entries(summary)) {
  const tags = Object.entries(s.tags).map(([l, t]) => `${l} P${t.precision ?? '-'}/R${t.recall ?? '-'}${t.pass ? ' PASS' : ''}`).join(', ');
  console.log(`${k.padEnd(32)} n ${String(s.items).padStart(3)} | tempo ${s.tempo.items ? `acc1 ${s.tempo.acc1OfAll} acc2 ${s.tempo.acc2OfAll} (shown ${s.tempo.shown}/${s.tempo.items})` : '-'} | key ${s.key.majorMinorItems ? `exact ${s.key.exactOfAll} tonic ${s.key.tonicOfAll} rel ${s.key.relative} (shown ${s.key.shown}/${s.key.majorMinorItems})` : '-'}${s.key.modalItems ? ` modal tonic ${s.key.modalTonicOfAll}` : ''} | ${tags}`);
}
