import { IGNORED_DIRS } from '../config';
import { posixJoin } from '../util/posixPath';
import { isIngestCandidate } from './fileRouter';
import { hasUnignoreUnder, mergeGitIgnoreRules, pathIsGitIgnored, type GitIgnoreRule } from './gitignore';
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
      const childPath = relativeDir ? posixJoin(relativeDir, name) : name;
      // A default-ignored dir (node_modules, dist, …) is only worth walking
      // when a gitignore negation might reach inside it; otherwise skip it
      // outright rather than enumerating a huge vendor tree.
      if (ignoredDirectory(name) && !hasUnignoreUnder(childPath, rules)) continue;
      if (pathIsGitIgnored(childPath, true, rules)) continue;
      await walk(entry as FileSystemDirectoryHandle, rootName, childPath, rules, output);
      continue;
    }
    if (entry.kind !== 'file') continue;
    if (!isIngestCandidate(name)) continue;
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

// ---------------------------------------------------------------------------
// <input webkitdirectory> support: the browser hands back a FLAT file list
// (each File carrying webkitRelativePath), so rebuild the directory tree and
// run it through the exact same walk as scanFolder — one filtering
// implementation (gitignore, ignored dirs, dotfiles, lockfiles) for both the
// File System Access picker and the fallback input.
// ---------------------------------------------------------------------------

interface SyntheticDirectory {
  name: string;
  directories: Map<string, SyntheticDirectory>;
  files: Map<string, File>;
}

function syntheticHandle(directory: SyntheticDirectory): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name: directory.name,
    entries: async function* entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
      for (const [name, child] of directory.directories) {
        yield [name, syntheticHandle(child) as unknown as FileSystemHandle];
      }
      for (const [name, file] of directory.files) {
        const fileHandle = { kind: 'file' as const, name, getFile: () => Promise.resolve(file) };
        yield [name, fileHandle as unknown as FileSystemHandle];
      }
    },
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

/**
 * scanFolder over a flat `<input webkitdirectory>` selection. Returns the
 * same NamedFile[] (filtered, sorted, `rootName/`-prefixed paths) a
 * showDirectoryPicker walk of the same folder would produce.
 */
export async function scanPickedFolderFiles(files: File[]): Promise<NamedFile[]> {
  let rootName: string | null = null;
  const root: SyntheticDirectory = { name: '', directories: new Map(), files: new Map() };
  for (const file of files) {
    const relative = file.webkitRelativePath;
    const segments = relative ? relative.split('/').filter(Boolean) : [];
    // webkitdirectory always reports "root/…/name"; anything shorter is not
    // part of a folder selection.
    if (segments.length < 2) continue;
    if (rootName === null) rootName = segments[0];
    else if (segments[0] !== rootName) continue; // a folder pick has one root
    let directory = root;
    for (const segment of segments.slice(1, -1)) {
      let child = directory.directories.get(segment);
      if (!child) {
        child = { name: segment, directories: new Map(), files: new Map() };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.files.set(segments[segments.length - 1], file);
  }
  if (rootName === null) return [];
  root.name = rootName;
  return scanFolder(syntheticHandle(root));
}
