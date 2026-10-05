// Calibration-only check of single-note pitch detection on short clips.
// NSynth notes carry their MIDI pitch; drums, claps and noises in the same split must stay unpitched.
// Usage: npx vite-node scripts/short-clip-pitch.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import { detectRepeatedPitch } from '../src/audio/detectedPitch';

const B = 'docs/evaluations/short-clips-2026-10-04';
const AUDIO = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips/bench-audio';
const manifest = JSON.parse(readFileSync(`${B}/manifest.json`, 'utf8'));
const meta = JSON.parse(readFileSync(`${B}/item-meta.json`, 'utf8'));
const engine = new Essentia(EssentiaWASM);
const unpitched = labels => labels.some(l => ['Bass_drum', 'Snare_drum', 'Hi-hat', 'Clapping', 'Finger_snapping', 'Cymbal', 'Crash_cymbal', 'Tambourine', 'Rattle_(instrument)',
  'Whoosh_and_swoosh_and_swish', 'Explosion', 'Thump_and_thud', 'Door', 'Gunshot_and_gunfire', 'Shatter', 'Scratching_(performance_technique)'].includes(l));
const r = { notes: 0, shown: 0, correct: 0, unpitched: 0, falsePitch: 0, byLength: {} };
for (const item of manifest.items.filter(i => i.split === 'calibration')) {
  const m = meta[item.id];
  const isNote = m.dataset === 'nsynth' && m.instrumentSource === 'acoustic' && !['mallet'].includes(m.family);
  const isUnpitched = m.dataset === 'fsd50k' && unpitched(m.fsdLabels) || m.dataset === 'avp';
  if (!isNote && !isUnpitched) continue;
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', `${AUDIO}/${item.id}.wav`, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
  const pitch = detectRepeatedPitch(engine, samples);
  if (isNote) {
    const k = m.durationSeconds <= 1 ? '1 s' : '2 s'; const row = r.byLength[k] ??= [0, 0, 0];
    r.notes++; row[0]++;
    if (pitch) { r.shown++; row[1]++; if (pitch.pitchClass === m.pitchClass) { r.correct++; row[2]++; } }
  } else { r.unpitched++; if (pitch) r.falsePitch++; }
}
console.log(JSON.stringify({ ...r, precision: r.shown ? r.correct / r.shown : null, recall: r.notes ? r.correct / r.notes : null }, null, 1));
