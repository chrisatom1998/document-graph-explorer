import { describe, expect, it, vi } from 'vitest';
import { scanFolder, scanPickedFolderFiles } from './folderScanner';

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

  it('includes extensionless and unknown-extension files for text sniffing', async () => {
    const license = fileHandle('LICENSE');
    const rules = fileHandle('team.rules');
    const png = fileHandle('icon.png');
    const root = directoryHandle('vault', [
      ['LICENSE', license.handle],
      ['team.rules', rules.handle],
      ['icon.png', png.handle],
    ]);

    await expect(scanFolder(root.handle)).resolves.toEqual([
      { file: license.file, path: 'vault/LICENSE' },
      { file: rules.file, path: 'vault/team.rules' },
    ]);
    expect(png.getFile).not.toHaveBeenCalled();
  });

  it('includes source files and skips lockfiles, vendor trees, and gitignored paths', async () => {
    const app = fileHandle('app.ts');
    const readme = fileHandle('README.md');
    const lock = fileHandle('package-lock.json');
    const ignoredLog = fileHandle('debug.log');
    const vendorDoc = fileHandle('lib.go');
    const gitignore = {
      file: { name: '.gitignore', text: vi.fn().mockResolvedValue('*.log\n') } as unknown as File,
      getFile: vi.fn(),
    };
    gitignore.getFile.mockResolvedValue(gitignore.file);
    const gitignoreHandle = {
      kind: 'file',
      name: '.gitignore',
      getFile: gitignore.getFile,
    } as unknown as FileSystemFileHandle;
    const vendor = directoryHandle('vendor', [['lib.go', vendorDoc.handle]]);
    const src = directoryHandle('src', [
      ['app.ts', app.handle],
      ['debug.log', ignoredLog.handle],
    ]);
    const root = directoryHandle('repo', [
      ['.gitignore', gitignoreHandle],
      ['README.md', readme.handle],
      ['package-lock.json', lock.handle],
      ['vendor', vendor.handle],
      ['src', src.handle],
    ]);

    await expect(scanFolder(root.handle)).resolves.toEqual([
      { file: readme.file, path: 'repo/README.md' },
      { file: app.file, path: 'repo/src/app.ts' },
    ]);
    expect(lock.getFile).not.toHaveBeenCalled();
    expect(ignoredLog.getFile).not.toHaveBeenCalled();
    expect(vendor.entries).not.toHaveBeenCalled();
    expect(gitignore.getFile).toHaveBeenCalled();
  });

  it('walks a default-ignored dir only far enough to honor a gitignore negation', async () => {
    const keep = fileHandle('keep.md');
    const out = fileHandle('out.js');
    const readme = fileHandle('README.md');
    const depDoc = fileHandle('package.md');
    const gitignore = {
      file: { name: '.gitignore', text: vi.fn().mockResolvedValue('dist/*\n!dist/keep.md\n') } as unknown as File,
      getFile: vi.fn(),
    };
    gitignore.getFile.mockResolvedValue(gitignore.file);
    const gitignoreHandle = {
      kind: 'file',
      name: '.gitignore',
      getFile: gitignore.getFile,
    } as unknown as FileSystemFileHandle;
    const dist = directoryHandle('dist', [
      ['keep.md', keep.handle],
      ['out.js', out.handle],
    ]);
    const nodeModules = directoryHandle('node_modules', [['package.md', depDoc.handle]]);
    const root = directoryHandle('repo', [
      ['.gitignore', gitignoreHandle],
      ['dist', dist.handle],
      ['node_modules', nodeModules.handle],
      ['README.md', readme.handle],
    ]);

    await expect(scanFolder(root.handle)).resolves.toEqual([
      { file: keep.file, path: 'repo/dist/keep.md' },
      { file: readme.file, path: 'repo/README.md' },
    ]);
    expect(out.getFile).not.toHaveBeenCalled();
    expect(nodeModules.entries).not.toHaveBeenCalled();
  });
});

// Fake File as produced by <input webkitdirectory>: a flat list where every
// entry carries its full "root/…/name" path in webkitRelativePath.
function pickedFile(relativePath: string, text = ''): File {
  const segments = relativePath.split('/');
  return {
    name: segments[segments.length - 1],
    webkitRelativePath: relativePath,
    text: vi.fn().mockResolvedValue(text),
  } as unknown as File;
}

describe('scanPickedFolderFiles', () => {
  it('rebuilds the tree and returns supported files with sorted root-relative paths', async () => {
    const rootDoc = pickedFile('vault/zeta.txt');
    const nestedDoc = pickedFile('vault/notes/alpha.md');
    const deepDoc = pickedFile('vault/notes/deep/report.pdf');

    await expect(scanPickedFolderFiles([rootDoc, deepDoc, nestedDoc])).resolves.toEqual([
      { file: nestedDoc, path: 'vault/notes/alpha.md' },
      { file: deepDoc, path: 'vault/notes/deep/report.pdf' },
      { file: rootDoc, path: 'vault/zeta.txt' },
    ]);
  });

  it('applies the same relevance filters as a folder drop', async () => {
    const readme = pickedFile('repo/README.md');
    const app = pickedFile('repo/src/app.ts');
    const gitignore = pickedFile('repo/.gitignore', '*.log\n');
    const files = [
      readme,
      app,
      gitignore,
      pickedFile('repo/package-lock.json'), // lockfile
      pickedFile('repo/image.png'), // unsupported type
      pickedFile('repo/.env.md'), // dotfile
      pickedFile('repo/.private/secret.md'), // hidden dir
      pickedFile('repo/node_modules/dep/package.md'), // ignored dir
      pickedFile('repo/dist/out.md'), // ignored dir
      pickedFile('repo/src/debug.log'), // gitignored
    ];

    await expect(scanPickedFolderFiles(files)).resolves.toEqual([
      { file: readme, path: 'repo/README.md' },
      { file: app, path: 'repo/src/app.ts' },
    ]);
  });

  it('honors a gitignore negation reaching into a default-ignored dir', async () => {
    const keep = pickedFile('repo/dist/keep.md');
    const readme = pickedFile('repo/README.md');
    const files = [
      pickedFile('repo/.gitignore', 'dist/*\n!dist/keep.md\n'),
      keep,
      pickedFile('repo/dist/out.md'),
      readme,
    ];

    await expect(scanPickedFolderFiles(files)).resolves.toEqual([
      { file: keep, path: 'repo/dist/keep.md' },
      { file: readme, path: 'repo/README.md' },
    ]);
  });

  it('returns no files for an empty or pathless selection', async () => {
    await expect(scanPickedFolderFiles([])).resolves.toEqual([]);
    const loose = { name: 'a.md', webkitRelativePath: '' } as unknown as File;
    await expect(scanPickedFolderFiles([loose])).resolves.toEqual([]);
  });
});
