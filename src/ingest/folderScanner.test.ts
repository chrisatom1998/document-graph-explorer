import { describe, expect, it, vi } from 'vitest';
import { scanFolder } from './folderScanner';

type HandleEntry = [string, FileSystemHandle];

function fileHandle(name: string): {
  file: File;
  getFile: ReturnType<typeof vi.fn>;
  handle: FileSystemFileHandle;
} {
  const file = { name } as File;
  const getFile = vi.fn().mockResolvedValue(file);
  return {
    file,
    getFile,
    handle: { kind: 'file', name, getFile } as unknown as FileSystemFileHandle,
  };
}

function directoryHandle(
  name: string,
  children: HandleEntry[],
): {
  entries: ReturnType<typeof vi.fn>;
  handle: FileSystemDirectoryHandle;
} {
  const entries = vi.fn(() =>
    (async function* iterator(): AsyncIterableIterator<HandleEntry> {
      for (const child of children) yield child;
    })(),
  );
  return {
    entries,
    handle: { kind: 'directory', name, entries } as unknown as FileSystemDirectoryHandle,
  };
}

describe('scanFolder', () => {
  it('recurses into folders, returns supported files with sorted root-relative paths', async () => {
    const rootDoc = fileHandle('zeta.txt');
    const nestedDoc = fileHandle('alpha.md');
    const deepDoc = fileHandle('report.pdf');
    const deep = directoryHandle('deep', [['report.pdf', deepDoc.handle]]);
    const notes = directoryHandle('notes', [
      ['alpha.md', nestedDoc.handle],
      ['deep', deep.handle],
    ]);
    const root = directoryHandle('vault', [
      ['zeta.txt', rootDoc.handle],
      ['notes', notes.handle],
    ]);

    await expect(scanFolder(root.handle)).resolves.toEqual([
      { file: nestedDoc.file, path: 'vault/notes/alpha.md' },
      { file: deepDoc.file, path: 'vault/notes/deep/report.pdf' },
      { file: rootDoc.file, path: 'vault/zeta.txt' },
    ]);
  });

  it('does not traverse hidden or ignored folders and does not read unsupported files', async () => {
    const visible = fileHandle('README.md');
    const hiddenFile = fileHandle('.private.md');
    const unsupported = fileHandle('image.png');
    const dependencyDoc = fileHandle('package.md');
    const buildDoc = fileHandle('artifact.txt');
    const hiddenDoc = fileHandle('secret.txt');
    const dependencies = directoryHandle('node_modules', [['package.md', dependencyDoc.handle]]);
    const build = directoryHandle('BUILD', [['artifact.txt', buildDoc.handle]]);
    const hidden = directoryHandle('.private', [['secret.txt', hiddenDoc.handle]]);
    const root = directoryHandle('vault', [
      ['node_modules', dependencies.handle],
      ['BUILD', build.handle],
      ['.private', hidden.handle],
      ['.private.md', hiddenFile.handle],
      ['image.png', unsupported.handle],
      ['README.md', visible.handle],
    ]);

    await expect(scanFolder(root.handle)).resolves.toEqual([
      { file: visible.file, path: 'vault/README.md' },
    ]);
    expect(dependencies.entries).not.toHaveBeenCalled();
    expect(build.entries).not.toHaveBeenCalled();
    expect(hidden.entries).not.toHaveBeenCalled();
    expect(hiddenFile.getFile).not.toHaveBeenCalled();
    expect(unsupported.getFile).not.toHaveBeenCalled();
  });
});
