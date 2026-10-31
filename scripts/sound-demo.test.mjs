// Tests for the standalone sound demo page (public/sound-demo.html).
// Run with: npm run test:sound-demo   (plain Node, no build or browser needed)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LABELS, analyze, noteName, toMono } from '../public/sound-demo/analyze.js';
import { SAMPLES, SAMPLE_RATE } from '../public/sound-demo/synth.js';

const fixture = (name) =>
  fileURLToPath(new URL(`../src/audio/sourceMatching/testfixtures/${name}`, import.meta.url));

/** Minimal WAV reader (16-bit PCM) so we can test against real recordings. */
function readWav(path) {
  const b = readFileSync(path);
  let o = 12;
  let fmt = null;
  let data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(o + 10), sampleRate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') {
      data = b.subarray(o + 8, o + 8 + size);
      break;
    }
    o += 8 + size + (size & 1);
  }
  assert.ok(fmt && data, 'WAV has fmt and data chunks');
  assert.equal(fmt.bits, 16);
  const n = Math.floor(data.length / 2 / fmt.channels);
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < fmt.channels; c++) channels[c][i] = data.readInt16LE((i * fmt.channels + c) * 2) / 32768;
  }
  return { sampleRate: fmt.sampleRate, samples: toMono(channels) };
}

test('every built-in sample is labelled with its known right answer', () => {
  for (const sample of SAMPLES) {
    const result = analyze(sample.make(), SAMPLE_RATE);
    assert.equal(result.verdict, 'likely', `${sample.id}: verdict`);
    assert.equal(result.results[0].label, sample.expected, `${sample.id}: top label`);
  }
});

test('every built-in sample expects a label the listener can actually produce', () => {
  for (const sample of SAMPLES) assert.ok(LABELS.includes(sample.expected), sample.id);
});

test('the winning label beats the runner-up by a clear margin', () => {
  for (const sample of SAMPLES) {
    const [first, second] = analyze(sample.make(), SAMPLE_RATE).allScores;
    assert.ok(first.score - second.score >= 0.2, `${sample.id}: ${first.label} vs ${second.label}`);
  }
});

test('silence is reported as silence, not guessed at', () => {
  const result = analyze(new Float32Array(SAMPLE_RATE), SAMPLE_RATE);
  assert.equal(result.verdict, 'silent');
  assert.deepEqual(result.results, []);
});

test('a clip that matches nothing well says "unclear" instead of forcing a label', () => {
  // Steady, loud, mid-range hum for 0.5 s: not obviously any of the seven types.
  const hum = new Float32Array(Math.floor(SAMPLE_RATE * 0.5));
  for (let i = 0; i < hum.length; i++) hum[i] = 0.5 * Math.sin((2 * Math.PI * 1500 * i) / SAMPLE_RATE);
  const result = analyze(hum, SAMPLE_RATE);
  assert.notEqual(result.results[0]?.label, 'kick');
  assert.notEqual(result.results[0]?.label, 'hi-hat');
});

test('only the first ten seconds are analysed', () => {
  const long = new Float32Array(SAMPLE_RATE * 12);
  long.set(SAMPLES[0].make(), 0);
  const { measurements } = analyze(long, SAMPLE_RATE);
  assert.ok(measurements.seconds <= 10.0001);
});

test('pitch names are right', () => {
  assert.equal(noteName(440), 'A4');
  assert.equal(noteName(55), 'A1');
  assert.equal(noteName(261.63), 'C4');
  assert.equal(noteName(0), null);
});

test('stereo is mixed down to mono', () => {
  const mono = toMono([Float32Array.of(1, 0), Float32Array.of(0, 1)]);
  assert.deepEqual(Array.from(mono), [0.5, 0.5]);
});

test('real recordings get sensible labels (flute = sustained, marimba = short pitched note)', () => {
  const flute = readWav(fixture('iowa-flute-first8s.wav'));
  assert.equal(analyze(flute.samples, flute.sampleRate).results[0].label, 'pad / sustained tone');

  const marimba = readWav(fixture('iowa-marimba-C7.wav')); // 96 kHz, stereo
  assert.equal(analyze(marimba.samples, marimba.sampleRate).results[0].label, 'pluck / lead');
});

test('the page ships no inline scripts (the site security policy would block them)', () => {
  const html = readFileSync(new URL('../public/sound-demo.html', import.meta.url), 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'found an inline <script>');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'found an inline event handler');
});
