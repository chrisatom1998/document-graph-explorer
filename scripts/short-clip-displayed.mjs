// Turn a DGE graph export into the exact Sounds-panel tags, then into benchmark predictions.
// Usage: npx vite-node scripts/short-clip-displayed.mjs <graph-export.json> <out-prefix>
// Uses the app's own display functions; nothing is re-implemented here except the
// fixed mapping from displayed DGE labels to benchmark categories (declared before scoring).
import { readFileSync, writeFileSync } from 'node:fs';
import { confidentSoundSummary } from '../src/audio/confidentSoundSummary';
import { filenameSoundFallback } from '../src/audio/filenameSoundFallback';
import { DJ_TYPE_SOURCE } from '../src/audio/djTags';

const [exportPath, outPrefix] = process.argv.slice(2);
const graph = JSON.parse(readFileSync(exportPath, 'utf8'));

const VOCAL = ['vocal one-shot', 'vocal chops', 'chops', 'vocal phrase', 'spoken phrase', 'whisper', 'vocal shout', 'vocal chant', 'vocal ad-lib', 'vocal hum', 'vocal vowel', 'choir',
  'vocal harmony', 'vocal scream', 'vocal laugh', 'vocal gasp', 'beatbox', 'vocoder vocal', 'pitched vocal', 'reversed vocal', 'vocal pad', 'vocal breath', 'vocal shush'];
const HITS = ['kick', 'snare', 'clap', 'closed hi-hat', 'open hi-hat', 'ride cymbal', 'crash cymbal', 'rimshot', 'tom', 'shaker', 'tambourine', 'conga', 'bongo',
  'cowbell', 'clave', 'woodblock', 'finger snap', 'percussion hit', 'hi-hat', 'cymbal'];
const LOOPS = ['drum loop', 'percussion loop', 'hi-hat loop', 'shaker loop', 'breakbeat', 'drum fill', 'snare roll', 'top loop', 'synth arpeggio', 'synth sequence'];
const BASS = ['bass hit', 'sub bass', 'reese bass', 'wobble bass', 'bass growl', 'acid bass', '808 bass', 'bass pluck', 'foghorn bass', 'rubbery bass', 'synth bass'];
const SYNTH = Object.entries(DJ_TYPE_SOURCE).filter(([l, s]) => s === 'synthesizer' && !LOOPS.includes(l) && !['atmospheric pad', 'synth drone'].includes(l)).map(([l]) => l);
/** Displayed (dimension, label) -> benchmark categories. Fixed before any scoring. */
export const CATEGORY_MAP = [
  ['effect', ['kick'], 'role:kick'], ['effect', ['snare'], 'role:snare'], ['effect', ['hi-hat', 'closed hi-hat', 'open hi-hat'], 'role:hi-hat'],
  ['effect', ['cymbal', 'crash cymbal', 'ride cymbal'], 'role:cymbal'], ['effect', ['clap'], 'role:clap'], ['effect', ['finger snap'], 'role:finger snap'],
  ['effect', ['tambourine'], 'role:tambourine'], ['effect', ['cowbell'], 'role:cowbell'], ['effect', ['shaker'], 'role:shaker'],
  ['effect', HITS, 'role:percussion hit'], ['effect', ['whoosh', 'noise sweep'], 'role:whoosh'], ['effect', ['impact', 'reverse impact'], 'role:impact'],
  ['effect', ['vinyl scratch'], 'role:vinyl scratch'], ['effect', VOCAL, 'role:vocal one-shot'], ['effect', ['beatbox'], 'role:beatbox'],
  ['effect', BASS, 'role:bass hit'], ['effect', SYNTH, 'role:synth hit'], ['effect', LOOPS, 'role:loop'],
  ['source', ['voice'], 'source:voice'], ['source', ['drums', 'percussion', 'hand percussion', 'drum kit', 'drum machine'], 'source:drums'],
  ['source', ['guitar', 'acoustic guitar', 'electric guitar', 'steel guitar'], 'source:guitar'], ['source', ['bass guitar'], 'source:bass guitar'],
  ['source', ['piano', 'electric piano'], 'source:piano'], ['source', ['synthesizer'], 'source:synthesizer'],
  ['source', ['trumpet', 'trombone', 'horn', 'tuba', 'brass'], 'source:brass'],
  ['character', ['distorted'], 'effect:distorted'], ['character', ['reverberant'], 'effect:reverberant'],
];

const rows = [];
const all = [];
const full = [];
for (const node of graph.nodes) {
  const name = node.path ?? node.title;
  if (!node.audio || !/^s[cy]-[0-9a-f]{16}\.wav$/.test(name)) continue;
  const itemId = name.slice(0, -4);
  const audio = node.audio;
  const scored = confidentSoundSummary(audio, audio.recognition?.mode);
  const names = filenameSoundFallback(audio, node, scored);
  const shown = new Map();   // category -> maybe-only
  for (const s of scored) for (const [dim, labels, cat] of CATEGORY_MAP)
    if (s.dimension === dim && labels.includes(s.label)) shown.set(cat, (shown.get(cat) ?? true) && !!s.maybe);
  if (audio.key) shown.set('musical:key', false);
  if (audio.tempo) shown.set('musical:tempo', false);
  for (const [cat, maybe] of shown) {
    const [dimension, label] = [cat.slice(0, cat.indexOf(':')), cat.slice(cat.indexOf(':') + 1)];
    all.push({ itemId, dimension, label, decision: 'accepted' });
    if (!maybe) full.push({ itemId, dimension, label, decision: 'accepted' });
  }
  rows.push({ itemId, durationSeconds: audio.durationSeconds, status: audio.recognition?.status,
    jobs: Object.fromEntries((audio.recognition?.jobs ?? []).map(j => [j.modelId, j.unsupportedReason ? 'unsupported' : j.status])),
    displayed: scored.map(s => ({ dimension: s.dimension, label: s.label, maybe: !!s.maybe, scores: s.scores })),
    filenameFallback: names, key: audio.key ?? null, tempo: audio.tempo ?? null, detectedPitch: audio.detectedPitch ?? null, notes: audio.notes });
}
writeFileSync(`${outPrefix}-displayed.json`, JSON.stringify(rows, null, 1));
writeFileSync(`${outPrefix}-predictions-all.json`, JSON.stringify(all));
writeFileSync(`${outPrefix}-predictions-full.json`, JSON.stringify(full));
console.log(`${rows.length} analysed clips; ${all.length} displayed category detections (${full.length} without "maybe").`);
