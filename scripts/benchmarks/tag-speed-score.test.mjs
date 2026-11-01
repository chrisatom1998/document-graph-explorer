import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coldModelLoadExcess, fastestReliable, preloadWallMs, summarizeMethod } from './tag-speed-score.mjs';

test('cold model load prefers measured preload wall time, else first-request excess', () => {
  assert.equal(preloadWallMs([{ start: 10, end: 40 }, { start: 12, end: 55 }]), 45);
  assert.equal(preloadWallMs([]), null);
  const excess = coldModelLoadExcess(
    [{ kind: 'instruments', ms: 800, failed: false }, { kind: 'instruments', ms: 100, failed: false }, { kind: 'tagger', ms: 50, failed: false }],
    [{ kind: 'instruments', ms: 200, failed: false }, { kind: 'instruments', ms: 220, failed: false }],
  );
  assert.equal(excess, 600);
  assert.equal(coldModelLoadExcess([{ kind: 'tagger', ms: 50, failed: false }], []), null);
});

test('the fastest reliable method is the lowest warm median that tagged every clip', () => {
  const fast = summarizeMethod('fast', [
    { role: 'cold', tagged: true, tagMs: 3000, requests: [{ kind: 'instruments', ms: 900, failed: false }], warmSpans: [], pageErrors: [] },
    { role: 'warm', tagged: true, tagMs: 1000, requests: [{ kind: 'instruments', ms: 400, failed: false }], pageErrors: [] },
    { role: 'warm', tagged: true, tagMs: 1200, requests: [{ kind: 'instruments', ms: 420, failed: false }], pageErrors: [] },
  ]);
  const full = summarizeMethod('full', [
    { role: 'cold', tagged: true, tagMs: 4000, requests: [], warmSpans: [{ start: 5, end: 25 }], pageErrors: [] },
    { role: 'warm', tagged: true, tagMs: 2000, requests: [], pageErrors: [] },
    { role: 'warm', tagged: false, tagMs: null, requests: [], pageErrors: [] },
  ]);
  assert.equal(fast.coldModelLoadMethod, 'first-request-excess');
  assert.equal(fast.coldModelLoadMs, 500);
  assert.equal(fast.warmMedianMs, 1000);
  assert.equal(fast.warmP95Ms, 1200);
  assert.equal(fast.reliable, true);
  assert.equal(full.coldModelLoadMethod, 'preload-wall');
  assert.equal(full.coldModelLoadMs, 20);
  assert.equal(full.reliable, false);
  assert.equal(fastestReliable([full, fast])?.method, 'fast');
  assert.equal(fastestReliable([full]), null);
});
