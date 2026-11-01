import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { learnedDjScores } from './learnedDjModel';
import { learnedHeadsStamp } from './learnedIntegrity';
import { loadBundledLearnedModel } from './loadBundledLearnedModel';
import { readLearnedModel } from './readLearnedModel';

/** Semantic fingerprint of the monolithic learned.json this split replaced (group, label, threshold, bias, flags, every weight). */
const SHIPPED_HEAD_FINGERPRINT = '72e25c6c916814a642b69dcd037071aca970fa9b9349642d58ee5326fbba96c9';

function fingerprint(model: NonNullable<ReturnType<typeof readLearnedModel>>): string {
  const rows = (model.heads ?? []).map(head => `${head.group}|${head.label}|${head.threshold}|${head.bias}|${head.maybe === true ? '1' : '0'}|${head.oneShot === true ? '1' : '0'}|${head.weights.join(',')}`);
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

describe('split learned heads', () => {
  it('loads the same heads and thresholds as the monolithic file', () => {
    const started = performance.now();
    const model = readLearnedModel();
    const diskMs = performance.now() - started;
    expect(model).toBeDefined();
    expect(model!.heads).toHaveLength(119);
    expect(model!.heads![0]).toMatchObject({ label: 'top loop', group: 'production' });
    expect(model!.heads!.at(-1)).toMatchObject({ label: 'rimshot' });
    expect(model!.heads!.find(head => head.label === 'kick')).toMatchObject({ group: 'production', threshold: 0.951 });
    expect(model!.heads!.find(head => head.label === 'snare')).toMatchObject({ threshold: 0.856 });
    expect(model!.heads!.find(head => head.label === 'piano')).toMatchObject({ group: 'source', threshold: 0.85 });
    expect(model!.heads!.find(head => head.label === 'electric guitar')).toMatchObject({ threshold: 0.933 });
    expect(model!.heads!.find(head => head.label === 'distorted')).toMatchObject({ group: 'character', threshold: 0.566 });
    expect(model!.heads!.find(head => head.label === 'vocal chops')).toMatchObject({ threshold: 0.904 });
    expect(fingerprint(model!)).toBe(SHIPPED_HEAD_FINGERPRINT);
    expect(diskMs).toBeLessThan(2000);
  });

  it('scores the same tags as the monolithic heads', () => {
    const model = readLearnedModel()!;
    const scores = learnedDjScores(Array.from({ length: 512 }, () => 1), model);
    expect(scores.map(score => [score.label, score.score.toFixed(6), Boolean(score.maybe)])).toEqual([
      ['drums', '0.612257', false],
      ['percussive', '0.667690', true],
    ]);
  });

  it('bundles every head into one module with the same thresholds', async () => {
    const started = performance.now();
    const bundled = await loadBundledLearnedModel();
    const bundleMs = performance.now() - started;
    expect(fingerprint(bundled!)).toBe(SHIPPED_HEAD_FINGERPRINT);
    expect(bundleMs).toBeLessThan(2000);
  });

  it('stamps analysis identity from head-sha256.txt instead of a shared manifest line', () => {
    const manifest = JSON.parse(readFileSync('public/sound-model/manifest.json', 'utf8')) as { sha256: Record<string, string> };
    expect(manifest.sha256['learned.json']).toBeUndefined();
    const integrity = readFileSync('public/sound-model/head-sha256.txt');
    expect(learnedHeadsStamp).toBe(createHash('sha256').update(integrity).digest('hex').slice(0, 16));
    expect(learnedHeadsStamp).toMatch(/^[a-f0-9]{16}$/);
    const lines = integrity.toString('utf8').trim().split('\n');
    expect(lines).toHaveLength(119);
    expect(new Set(lines.map(line => line.split(' ')[0])).size).toBe(119);
  });
});
