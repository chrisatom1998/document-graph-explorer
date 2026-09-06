// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { filesFromDataTransfer } from './DropZone';
import { useUiStore } from '../store/uiStore';

describe('folder drop traversal', () => {
  it('keeps readable siblings and reports failed file and directory entries', async () => {
    const good = new File(['Readable text'], 'good.txt');
    const children = [
      { name: 'bad.txt', fullPath: '/vault/bad.txt', isFile: true, isDirectory: false,
        file: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('Denied')) },
      { name: 'blocked', fullPath: '/vault/blocked', isFile: false, isDirectory: true,
        createReader: () => ({ readEntries: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('Denied')) }) },
      { name: 'good.txt', fullPath: '/vault/good.txt', isFile: true, isDirectory: false,
        file: (resolve: (file: File) => void) => resolve(good) },
    ];
    let read = false;
    const root = { name: 'vault', fullPath: '/vault', isDirectory: true, isFile: false,
      createReader: () => ({ readEntries: (resolve: (entries: unknown[]) => void) => {
        resolve(read ? [] : children); read = true;
      } }) };
    const transfer = { items: [{ kind: 'file', webkitGetAsEntry: () => root }] } as unknown as DataTransfer;
    const toast = vi.spyOn(useUiStore.getState(), 'pushToast');
    await expect(filesFromDataTransfer(transfer)).resolves.toEqual([{ file: good, path: 'vault/good.txt' }]);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('vault/bad.txt'), 'warning');
    toast.mockRestore();
  });
});
