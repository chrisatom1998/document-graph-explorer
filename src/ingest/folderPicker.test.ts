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

describe('standard folder picker', () => {
  it('uses a synchronous file chooser even when an embedded browser exposes the directory API', () => {
    window.showDirectoryPicker = vi.fn().mockRejectedValue(new DOMException('Unavailable', 'SecurityError'));
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    openFolderPicker();
    expect(click).toHaveBeenCalledOnce();
    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
    expect(document.querySelector('input[webkitdirectory]')).not.toBeNull();
    click.mockRestore();
  });

  it('recreates the input if it was removed from the document', () => {
    openFolderPicker();
    document.querySelector('input[webkitdirectory]')?.remove();
    openFolderPicker();
    expect(document.querySelector('input[webkitdirectory]')).not.toBeNull();
  });
});

describe('openFolderPicker selection', () => {
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
    expect(scanner.scanPickedFolderFiles).toHaveBeenCalledWith([picked], expect.any(Function));
  });

  it('reports an empty supported-file selection', async () => {
    scanner.scanPickedFolderFiles.mockResolvedValue([]);
    openFolderPicker();
    const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
    Object.defineProperty(input, 'files', { value: [{ name: 'ignored.bin', webkitRelativePath: 'vault/ignored.bin' }], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(toasts.pushToast).toHaveBeenCalledWith(expect.stringContaining('No supported files'), 'info'));
    expect(localFiles.ingestNamedFiles).not.toHaveBeenCalled();
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
