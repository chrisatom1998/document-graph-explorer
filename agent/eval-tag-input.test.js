import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputCacheIdentity } from '../scripts/eval-tag-input';

const dirs = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'eval-tag-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('evaluator cache reuse', () => {
  it('invalidates on audio bytes, selected file, row duration, offsets, and row IDs', () => {
    const dir = temp(), a = join(dir, 'a.npy'), b = join(dir, 'b.npy');
    writeFileSync(a, 'audio'); writeFileSync(b, 'audio');
    const policy = { rowSeconds: 4, ids: ['one'], offsets: [0, 5] };
    const original = inputCacheIdentity([a], policy);
    expect(inputCacheIdentity([a], policy)).toBe(original);
    expect(inputCacheIdentity([b], policy)).not.toBe(original);
    expect(inputCacheIdentity([a], { ...policy, rowSeconds: 2 })).not.toBe(original);
    expect(inputCacheIdentity([a], { ...policy, offsets: [1, 5] })).not.toBe(original);
    expect(inputCacheIdentity([a], { ...policy, ids: ['two'] })).not.toBe(original);
    writeFileSync(a, 'other');
    expect(inputCacheIdentity([a], policy)).not.toBe(original);
  });
});
