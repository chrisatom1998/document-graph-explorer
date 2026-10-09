import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertDisjoint, hash, inspectGraph, manifestDigest, percentile, scoreClips, validateManifest } from './core.mjs';

const labels = ['source:synthesizer', 'effect:vocal chops'];
function clip(id, truth = [1, 0], extra = {}) {
  return { id, file: `c${id.padStart(6, '0')}.wav`, sha256: hash(id), group: id, split: 'test', kind: 'loop', seconds: 5,
    truth: Object.fromEntries(labels.map((l, i) => [l, truth[i]])), provenance: { type: 'human-reviewed', reference: 'test fixture' }, ...extra };
}
const manifest = clips => ({ version: 1, labels, clips });

test('manifest seals are stable across JSON key order', () => {
  const m = manifest([clip('1')]);
  assert.equal(manifestDigest(m), manifestDigest({ clips: m.clips, labels: m.labels, version: 1 }));
});
test('rejects missing/guessed ground truth and leaking names', () => {
  for (const override of [{ truth: {} }, { truth: { [labels[0]]: 1, [labels[1]]: false } },
    { provenance: { type: 'model', reference: 'guess' } }, { file: 'synth-loop.wav' }, { file: '../c000001.wav' }]) {
    assert.throws(() => validateManifest(manifest([clip('1', [1, 0], override)])), /Invalid benchmark/);
  }
});
test('rejects duplicate bytes and families split across development and test', () => {
  assert.throws(() => validateManifest(manifest([clip('1'), clip('2', [0, 1], { sha256: hash('1') })])), /duplicate audio/);
  assert.throws(() => validateManifest(manifest([clip('1'), clip('2', [0, 1], { group: '1', split: 'development' })])), /crosses/);
  assert.throws(() => assertDisjoint(manifest([clip('1')]), manifest([clip('2', [1, 0], { group: '1' })])), /contamination/);
});
test('unknown labels never become negatives; zero F1 is numeric zero', () => {
  const m = manifest([clip('1', [1, null]), clip('2', [0, 1]), clip('3', [0, null])]);
  const report = scoreClips(m, [
    { id: '1', status: 'complete', labels: [labels[1]] },
    { id: '2', status: 'complete', labels: [labels[0]] },
    { id: '3', status: 'complete', labels: [] },
  ], { minSupport: 1 });
  assert.equal(report.labels[labels[0]].f1, 0);
  assert.equal(report.labels[labels[1]].unknown, 2);
  assert.equal(report.labels[labels[1]].fp, 0);
  assert.equal(report.labels[labels[1]].tn, 0);
  assert.equal(report.complete, true);
});
test('failed and missing clips penalize recall and never earn true negatives or a pass', () => {
  const report = scoreClips(manifest([clip('1'), clip('2'), clip('3', [0, 1])]), [
    { id: '1', status: 'complete', labels: [labels[0]] }, { id: '2', status: 'partial', labels: [labels[0]] },
  ], { minSupport: 1 });
  assert.equal(report.complete, false);
  assert.equal(report.status.partial, 1);
  assert.equal(report.status.missing, 1);
  assert.equal(report.labels[labels[0]].recall, .5);
  assert.equal(report.labels[labels[0]].tn, 0);
  assert.equal(report.labels[labels[0]].meets70, false);
  assert.equal(report.labels[labels[1]].unscored, 2);
});
test('support floor prevents claiming a one-example win; duration/kind slices are independent', () => {
  const report = scoreClips(manifest([clip('1', [1, 0], { seconds: 1, kind: 'one-shot' })]), [{ id: '1', status: 'complete', labels: [labels[0]] }]);
  assert.equal(report.labels[labels[0]].supported, false);
  assert.equal(report.labels[labels[0]].meets70, false);
  assert.equal(report.slices['under-2s'].clips, 1);
  assert.equal(report.slices['loop'].clips, 0);
  assert.equal(report.labels[labels[1]].precision, null);
});
test('duplicate predictions are rejected; absent split cannot pass vacuously', () => {
  const p = { id: '1', status: 'complete', labels: [] };
  assert.throws(() => scoreClips(manifest([clip('1')]), [p, p]), /Duplicate prediction/);
  assert.throws(() => scoreClips(manifest([clip('1')]), [], { split: 'development' }), /No development/);
});
test('a detector that never fires earns zero F1 when positives exist', () => {
  const report = scoreClips(manifest([clip('1')]), [{ id: '1', status: 'complete', labels: [] }]);
  assert.equal(report.labels[labels[0]].precision, null);
  assert.equal(report.labels[labels[0]].recall, 0);
  assert.equal(report.labels[labels[0]].f1, 0);
});
test('completion requires each distinct file; terminal failure is not success', () => {
  const node = { path: 'c000001.wav', audio: { recognition: { status: 'failed' } } };
  assert.equal(inspectGraph({ nodes: [node], edges: [] }, ['c000001.wav']).terminal, true);
  assert.equal(inspectGraph({ nodes: [node], edges: [] }, ['c000001.wav']).complete, 0);
  assert.equal(inspectGraph({ nodes: [node, node], edges: [] }, ['c000001.wav', 'c000002.wav']).terminal, false);
  assert.equal(inspectGraph({ nodes: [{ ...node, audio: { stage: 'preview', recognition: { status: 'complete' } } }], edges: [] }, ['c000001.wav']).terminal, false);
});
test('nearest-rank percentile includes zero and ignores unavailable measurements', () => {
  assert.equal(percentile([0, null, 20, 10], .5), 10);
  assert.equal(percentile([1, 2, 3], .95), 3);
  assert.equal(percentile([], .95), null);
});
test('review adapter accepts explicit human confirmation only and keeps unknown categories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dge-reviews-'));
  try {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ items: [{ id: '1', preview: 'audio/1.wav' }] }));
    const review = { confirmed: true, provenance: 'assistant review', reviewedAt: '2026-10-09', knownLabels: ['production:vocal chops'], labels: { production: ['vocal chops'] } };
    writeFileSync(join(dir, 'reviews.json'), JSON.stringify({ 1: review }));
    writeFileSync(join(dir, 'assignments.json'), JSON.stringify({ labels, clips: { 1: { group: 'pack-1', split: 'test', kind: 'loop', id: 'wrong', path: '/wrong.wav' } } }));
    const run = () => spawnSync(process.execPath, ['scripts/benchmarks/reviews.mjs', dir, join(dir, 'assignments.json'), join(dir, 'out.json')], { encoding: 'utf8' });
    assert.notEqual(run().status, 0);
    assert.equal(existsSync(join(dir, 'out.json')), false);
    review.provenance = 'explicit human confirmation';
    writeFileSync(join(dir, 'reviews.json'), JSON.stringify({ 1: review }));
    const result = run(); assert.equal(result.status, 0, result.stderr);
    const item = JSON.parse(readFileSync(join(dir, 'out.json'))).clips[0];
    assert.equal(item.id, '1');
    assert.equal(item.path, join(dir, 'audio/1.wav'));
    assert.deepEqual(item.truth, { [labels[0]]: null, [labels[1]]: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
