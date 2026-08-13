// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scanner = vi.hoisted(() => ({
  scanFolder: vi.fn(),
  scanPickedFolderFiles: vi.fn(),
}));
const localFiles = vi.hoisted(() => ({ ingestNamedFiles: vi.fn() }));
const toasts = vi.hoisted(() => ({ pushToast: vi.fn() }));

vi.mock('./folderScanner', () => scanner);
vi.mock('./localFiles', () => localFiles);
vi.mock('../store/uiStore', () => ({
  useUiStore: { getState: () => ({ pushToast: toasts.pushToast }) },
}));

import { openFolderPicker } from './folderPicker';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  scanner.scanFolder.mockReset();
  scanner.scanPickedFolderFiles.mockReset();
  localFiles.ingestNamedFiles.mockReset().mockResolvedValue(undefined);
  toasts.pushToast.mockReset();
});

afterEach(() => {
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe('openFolderPicker with the File System Access API', () => {
  it('scans the picked directory and hands the result to the shared ingest path', async () => {
    const handle = { kind: 'directory', name: 'vault' } as unknown as FileSystemDirectoryHandle;
    const named = [{ file: { name: 'a.md' } as File, path: 'vault/a.md' }];
    window.showDirectoryPicker = vi.fn().mockResolvedValue(handle);
    scanner.scanFolder.mockResolvedValue(named);

    openFolderPicker();
    await vi.waitFor(() => expect(localFiles.ingestNamedFiles).toHaveBeenCalledWith(named));

    expect(window.showDirectoryPicker).toHaveBeenCalledWith({
      id: 'knowledge-nebula-add-folder',
      mode: 'read',
    });
    expect(scanner.scanFolder).toHaveBeenCalledWith(handle);
    expect(document.querySelector('input[webkitdirectory]')).toBeNull();
  });

  it('treats cancelling the picker as a no-op', async () => {
    window.showDirectoryPicker = vi
      .fn()
      .mockRejectedValue(new DOMException('user dismissed the picker', 'AbortError'));

    openFolderPicker();
    await flush();

    expect(scanner.scanFolder).not.toHaveBeenCalled();
    expect(localFiles.ingestNamedFiles).not.toHaveBeenCalled();
    expect(toasts.pushToast).not.toHaveBeenCalled();
  });

  it('toasts instead of ingesting when the folder has no supported files', async () => {
    const handle = { kind: 'directory', name: 'empty' } as unknown as FileSystemDirectoryHandle;
    window.showDirectoryPicker = vi.fn().mockResolvedValue(handle);
    scanner.scanFolder.mockResolvedValue([]);

    openFolderPicker();
    await vi.waitFor(() => expect(toasts.pushToast).toHaveBeenCalled());

    expect(toasts.pushToast).toHaveBeenCalledWith(expect.stringContaining('empty'), 'info');
    expect(localFiles.ingestNamedFiles).not.toHaveBeenCalled();
  });
});

describe('openFolderPicker webkitdirectory fallback', () => {
  it('routes the flat selection through scanPickedFolderFiles into the shared ingest path', async () => {
    const picked = {
      name: 'a.md',
      webkitRelativePath: 'vault/a.md',
    } as unknown as File;
    const named = [{ file: picked, path: 'vault/a.md' }];
    scanner.scanPickedFolderFiles.mockResolvedValue(named);

    openFolderPicker();
    const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]');
    expect(input).not.toBeNull();
    Object.defineProperty(input!, 'files', { value: [picked], configurable: true });
    input!.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(localFiles.ingestNamedFiles).toHaveBeenCalledWith(named));
    expect(scanner.scanPickedFolderFiles).toHaveBeenCalledWith([picked]);
  });

  it('does nothing when the fallback picker is dismissed with no selection', async () => {
    openFolderPicker();
    const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();

    expect(scanner.scanPickedFolderFiles).not.toHaveBeenCalled();
    expect(localFiles.ingestNamedFiles).not.toHaveBeenCalled();
    expect(toasts.pushToast).not.toHaveBeenCalled();
  });
});
