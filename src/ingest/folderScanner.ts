import { IGNORED_DIRS } from '../config';
import { posixJoin } from '../util/posixPath';
import { routeFile } from './fileRouter';
import { mergeGitIgnoreRules, pathIsGitIgnored, type GitIgnoreRule } from './gitignore';
import type { NamedFile } from './localFiles';
import { repoArtifactReason } from './repoArtifacts';

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

async function readGitignore(
  children: [string, FileSystemHandle][],
): Promise<string | null> {
  const hit = children.find(([name, entry]) => name === '.gitignore' && entry.kind === 'file');
  if (!hit) return null;
  try {
    const file = await (hit[1] as FileSystemFileHandle).getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function walk(
  directory: DirectoryHandleLike,
  rootName: string,
  relativeDir: string,
  ancestorRules: GitIgnoreRule[],
  output: PendingFile[],
): Promise<void> {
  const children: [string, FileSystemHandle][] = [];
  for await (const child of directory.entries()) children.push(child);
  const rules = mergeGitIgnoreRules(ancestorRules, await readGitignore(children), relativeDir);

  for (const [name, entry] of children) {
    if (name === '.gitignore') continue;
    if (name.startsWith('.')) continue;
    if (entry.kind === 'directory') {
      if (ignoredDirectory(name)) continue;
      const childPath = relativeDir ? posixJoin(relativeDir, name) : name;
      if (pathIsGitIgnored(childPath, true, rules)) continue;
      await walk(entry as FileSystemDirectoryHandle, rootName, childPath, rules, output);
      continue;
    }
    if (entry.kind !== 'file') continue;
    if (repoArtifactReason(name) || routeFile(name) === null) continue;
    const relativePath = relativeDir ? posixJoin(relativeDir, name) : name;
    if (pathIsGitIgnored(relativePath, false, rules)) continue;
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
  await walk(handle, handle.name, '', [], pending);
  const output = await readFiles(pending);
  return output.sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));
}
