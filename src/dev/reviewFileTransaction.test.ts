import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withReviewFileTransaction } from './reviewFileTransaction';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dge-review-transaction-'));
  roots.push(root);
  await mkdir(join(root, 'public/sound-model'), { recursive: true });
  await writeFile(join(root, 'manifest.json'), 'original manifest');
  const writes = new Map([
    ['manifest.json', 'updated manifest'],
    ['public/sound-model/learned.json', 'synthetic learned content'],
  ]);
  return { root, writes, backup: join(root, 'operation/backup') };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('publishes a previously absent learned file and backs up existing originals', async () => {
  const { root, writes, backup } = await fixture();
  const result = await withReviewFileTransaction(writes, backup, async () => {
    expect(await readFile(join(root, 'public/sound-model/learned.json'), 'utf8')).toBe('synthetic learned content');
    return 'published';
  }, root);
  expect(result).toBe('published');
  expect(await readFile(join(backup, 'manifest.json'), 'utf8')).toBe('original manifest');
  await expect(access(join(backup, 'public/sound-model/learned.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe('updated manifest');
});

it('restores originals and removes only the newly created learned file on failure', async () => {
  const { root, writes, backup } = await fixture();
  await expect(withReviewFileTransaction(writes, backup, async () => {
    throw new Error('validation failed');
  }, root)).rejects.toThrow('validation failed');
  expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe('original manifest');
  await expect(access(join(root, 'public/sound-model/learned.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves concurrent edits to existing and newly created destinations during rollback', async () => {
  const { root, writes, backup } = await fixture();
  await expect(withReviewFileTransaction(writes, backup, async () => {
    await writeFile(join(root, 'manifest.json'), 'concurrent manifest');
    await writeFile(join(root, 'public/sound-model/learned.json'), 'concurrent learned content');
    throw new Error('validation failed');
  }, root)).rejects.toThrow('validation failed');
  expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe('concurrent manifest');
  expect(await readFile(join(root, 'public/sound-model/learned.json'), 'utf8')).toBe('concurrent learned content');
});

it('preserves concurrent deletion and still rolls back other files', async () => {
  const { root, writes, backup } = await fixture();
  await expect(withReviewFileTransaction(writes, backup, async () => {
    await rm(join(root, 'manifest.json'));
    throw new Error('validation failed');
  }, root)).rejects.toThrow('validation failed');
  await expect(access(join(root, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(join(root, 'public/sound-model/learned.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('fails before any writes when an original cannot be read as a file', async () => {
  const { root, writes, backup } = await fixture();
  await mkdir(join(root, 'public/sound-model/learned.json'));
  await expect(withReviewFileTransaction(writes, backup, async () => 'unused', root)).rejects.toBeDefined();
  expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe('original manifest');
});

it('rolls back completed writes when a later destination cannot be created', async () => {
  const { root, writes, backup } = await fixture();
  writes.set('missing-parent/file.json', 'cannot create');
  await expect(withReviewFileTransaction(writes, backup, async () => 'unused', root)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe('original manifest');
  await expect(access(join(root, 'public/sound-model/learned.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('backs up and restores an existing learned file instead of deleting it', async () => {
  const { root, writes, backup } = await fixture();
  await writeFile(join(root, 'public/sound-model/learned.json'), 'previous learned content');
  await expect(withReviewFileTransaction(writes, backup, async () => {
    throw new Error('validation failed');
  }, root)).rejects.toThrow('validation failed');
  expect(await readFile(join(root, 'public/sound-model/learned.json'), 'utf8')).toBe('previous learned content');
  expect(await readFile(join(backup, 'public/sound-model/learned.json'), 'utf8')).toBe('previous learned content');
});
