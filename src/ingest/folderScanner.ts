import { IGNORED_DIRS } from '../config';
import { routeFile } from './fileRouter';
import type { NamedFile } from './localFiles';

interface DirectoryHandleLike {
  name: string;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface PendingFile {
  handle: FileSystemFileHandle;
  path: string;
}

const FILE_METADATA_CONCURRENCY = 16;

function ignoredDirectory(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name) || IGNORED_DIRS.has(name.toLowerCase());
}

async function walk(
  directory: DirectoryHandleLike,
  rootName: string,
  relativeDir: string,
  output: PendingFile[],
): Promise<void> {
  for await (const [name, entry] of directory.entries()) {
    if (name.startsWith('.')) continue;
    if (entry.kind === 'directory') {
      if (ignoredDirectory(name)) continue;
      const childPath = relativeDir ? `${relativeDir}/${name}` : name;
      await walk(entry as FileSystemDirectoryHandle, rootName, childPath, output);
      continue;
    }
    if (entry.kind !== 'file' || routeFile(name) === null) continue;
    const relativePath = relativeDir ? `${relativeDir}/${name}` : name;
    output.push({
      handle: entry as FileSystemFileHandle,
      path: `${rootName}/${relativePath}`,
    });
  }
}

async function readFiles(pending: PendingFile[]): Promise<NamedFile[]> {
  const output = new Array<NamedFile>(pending.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const entry = pending[index];
      output[index] = { file: await entry.handle.getFile(), path: entry.path };
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(FILE_METADATA_CONCURRENCY, pending.length) },
      () => worker(),
    ),
  );
  return output;
}

/** Recursively enumerate supported files with stable root-relative paths. */
export async function scanFolder(handle: FileSystemDirectoryHandle): Promise<NamedFile[]> {
  const pending: PendingFile[] = [];
  await walk(handle, handle.name, '', pending);
  const output = await readFiles(pending);
  return output.sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));
}
