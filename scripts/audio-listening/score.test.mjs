import test from 'node:test';
import assert from 'node:assert/strict';
import { score, combined, classesFor } from './score.mjs';
test('fixed combinations expose recall gains and false-positive costs', () => {
  assert.deepEqual(combined(['drums'], ['voice']), { native: ['drums'], audio: ['voice'], union: ['drums', 'voice'], agreement: [], fallback: ['drums'] });
  assert.deepEqual(classesFor(['electric guitar', 'reverb']), ['guitar']);
  const items = [{ id: 'a', reviews: [
    { dimension: 'source', label: 'voice', state: 'present' },
    { dimension: 'source', label: 'drums', state: 'absent' },
    { dimension: 'source', label: 'piano', state: 'unknown' },
  ] }];
  const s = score(items, [{ id: 'a', native: ['drums'], audio: ['voice', 'piano'] }]);
  assert.equal(s.audio.micro.f1, 1);
  assert.equal(s.union.micro.fp, 1);
  assert.equal(s.union.micro.fn, 0);
  assert.equal(s.agreement.micro.fn, 1);
  assert.equal(s.fallback.micro.fp, 1);
  assert.deepEqual(s.audio.classes.piano, { tp: 0, fp: 0, fn: 0, tn: 0, precision: null, recall: null, f1: null });
});
test('missing baseline and failed requests cannot manufacture improvements', () => {
  const items = ['missing', 'failed'].map(id => ({ id, reviews: [{ dimension: 'source', label: 'voice', state: 'present' }] }));
  const s = score(items, [{ id: 'failed', error: 'timeout', native: [], audio: [] }]);
  for (const mode of Object.values(s)) { assert.equal(mode.evaluated, 0); assert.equal(mode.micro.f1, null); }
});
