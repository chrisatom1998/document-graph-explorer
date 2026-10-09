import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelMetrics, bindingMetrics, retrievalMetrics, loadManifest, digest } from './core.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('unknown labels and failed negative analyses earn no true negatives', () => {
  const clips = [1, 0, null].map((v, i) => ({ id: String(i), truth: { tags: { flute: v } } }));
  const r = labelMetrics(clips, [{ id: '0', status: 'failed' }, { id: '1', status: 'failed' }]).flute;
  assert.equal(r.fn, 1); assert.equal(r.tn, 0); assert.equal(r.unknown, 1); assert.equal(r.precision, null);
});
test('manifest rejects changed bytes and shared source groups across splits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dge-research-'));
  try {
    writeFileSync(join(dir, 'audio.wav'), 'test bytes');
    const clip = { id: 'a', group: 'same', split: 'development', seconds: 1,
      rights: { evaluationAllowed: true, basis: 'test' }, provenance: {}, truth: {},
      path: 'audio.wav', sha256: digest('test bytes') };
    const path = join(dir, 'manifest.json');
    writeFileSync(path, JSON.stringify({ version: 'dge-research-v1', clips: [clip, { ...clip, id: 'b', split: 'test' }] }));
    assert.throws(() => loadManifest(path), /Group leakage/);
    writeFileSync(path, JSON.stringify({ version: 'dge-research-v1', clips: [clip] }));
    writeFileSync(join(dir, 'audio.wav'), 'changed bytes');
    assert.throws(() => loadManifest(path), /checksum mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('binding ties are incorrect and missing output lowers end-to-end accuracy', () => {
  const r = bindingMetrics([{ status: 'complete', binding: { positive: .5, negative: .5 } },
    { status: 'complete', binding: { positive: .6, negative: .5 } }, { status: 'failed' }]);
  assert.equal(r.ties, 1); assert.equal(r.accuracy, .5); assert.equal(r.endToEndAccuracy, 1 / 3);
});
test('retrieval excludes same-original crops and skips unmeasurable queries', () => {
  const clips = [{ id: 'a', group: 'same', truth: { tags: { flute: 1 } } },
    { id: 'a-crop', group: 'same', truth: { tags: { flute: 1 } } },
    { id: 'b', group: 'other', truth: { tags: { flute: 0 } } }];
  const rows = clips.map(c => ({ id: c.id, status: 'complete', embedding: [1, 0] }));
  assert.equal(retrievalMetrics(clips, rows).queries, 0);
  clips.push({ id: 'c', group: 'third', truth: { tags: { flute: 1 } } });
  rows.push({ id: 'c', status: 'complete', embedding: [1, 1] });
  const r = retrievalMetrics(clips, rows, 1).results.find(x => x.id === 'a');
  assert.equal(r.gallery, 2); assert.equal(r.top[0].id, 'b'); assert.equal(r.precision, 0);
});
