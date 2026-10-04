import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

async function readExisting(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function atomicWrite(path: string, bytes: string | Buffer): Promise<void> {
  const temporary = `${path}.review-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

/** Back up source destinations before publication, including absence on first use.
 * Rollback leaves later edits/deletions intact and touches only completed writes.
 */
export async function withReviewFileTransaction<T>(
  writes: ReadonlyMap<string, string>, backupDirectory: string, publish: () => Promise<T>, root = process.cwd(),
): Promise<T> {
  const originals = new Map<string, Buffer | undefined>();
  for (const path of writes.keys()) {
    const original = await readExisting(resolve(root, path));
    originals.set(path, original);
    if (original !== undefined) {
      const backup = join(backupDirectory, path);
      await mkdir(dirname(backup), { recursive: true });
      await writeFile(backup, original);
    }
  }
  const written: string[] = [];
  try {
    for (const [path, content] of writes) {
      await atomicWrite(resolve(root, path), content);
      written.push(path);
    }
    return await publish();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const path of written.reverse()) {
      try {
        const destination = resolve(root, path);
        const current = await readExisting(destination);
        // A deleted or changed destination now belongs to another writer.
        if (!current?.equals(Buffer.from(writes.get(path)!))) continue;
        const original = originals.get(path);
        if (original === undefined) await rm(destination);
        else await atomicWrite(destination, original);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Review publication failed and some files could not be restored.');
    throw error;
  }
}
