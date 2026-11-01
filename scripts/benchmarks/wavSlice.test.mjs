import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slicePcmWav } from './wavSlice.mjs';

test('slices the committed flute fixture into a 2 second 16-bit PCM wav', () => {
  const source = readFileSync('src/audio/sourceMatching/testfixtures/iowa-flute-first8s.wav');
  const slice = slicePcmWav(source, 2, 2);
  assert.equal(slice.toString('ascii', 0, 4), 'RIFF');
  assert.equal(slice.toString('ascii', 8, 12), 'WAVE');
  assert.equal(slice.readUInt16LE(20), 1);
  assert.equal(slice.readUInt16LE(22), 1);
  assert.equal(slice.readUInt32LE(24), 44100);
  assert.equal(slice.readUInt32LE(40), 44100 * 2 * 2);
  assert.equal(slice.length, 44 + 44100 * 2 * 2);
  assert.notDeepEqual(slice.subarray(44, 80), source.subarray(44, 80));
});
