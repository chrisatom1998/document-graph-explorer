import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Budget, audioCost, comparison } from './metrics.mjs';
test('reserves worst case, retains unknown usage and never exceeds five dollars', () => {
  const b = new Budget(5); assert.equal(b.reserve(4.126), true); assert.equal(b.reserve(4.126), false);
  b.settle(4.126, null); assert.equal(b.charged, 4.126);
  assert.throws(() => b.settle(4.126, .1));
  const known = new Budget(5); known.reserve(4.126); known.settle(4.126, .1); assert.equal(known.reserve(4.126), true); assert.ok(known.charged <= 5);
  assert.throws(() => new Budget(6)); assert.equal(b.reserve(NaN), false);
});
test('prices missing audio details conservatively', () => {
  assert.equal(audioCost({ prompt_tokens: 1000, completion_tokens: 100 }).usd, .033);
  assert.equal(audioCost(null), null);
});
test('paired scores exclude provider failures and ignore unknown labels', () => {
  const items = [{ id: 'a', reviews: [{ dimension: 'source', label: 'piano', state: 'present' }] }, { id: 'b', reviews: [] }];
  const rows = [{ id: 'a', native: [], audio: ['piano'], lunaNormalized: [], lunaRouted: ['piano'] }, { id: 'b', error: {}, native: [], audio: [] }];
  const result = comparison(items, rows);
  assert.equal(result.lunaRouted.micro.tp, 1); assert.equal(result.native.micro.fn, 1);
  assert.equal(result.native.coverage.abstentions, 1); assert.equal(result.audio.evaluated, 1);
});
test('normalizes exact singular cymbal and stored slide-guitar labels equally for every variant', async () => {
  const { classesFor } = await import('../audio-listening/score.mjs');
  assert.deepEqual(classesFor(['cymbal', 'steel guitar / slide guitar']).sort(), ['cymbals', 'guitar']);
});
test('accepts recorded runtime thread variants but rejects stale model policies', async () => {
  const { sameDetectorConfiguration } = await import('./metrics.mjs');
  assert.equal(sameDetectorConfiguration('v1:wasm-threads-4-jamendo-1-v2', 'v1:wasm-threads-1-jamendo-1-v2'), true);
  assert.equal(sameDetectorConfiguration('v0:wasm-threads-4-jamendo-1-v2', 'v1:wasm-threads-1-jamendo-1-v2'), false);
  assert.equal(sameDetectorConfiguration(undefined, 'v1'), false);
});
