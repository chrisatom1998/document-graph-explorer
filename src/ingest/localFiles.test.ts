import { describe, expect, it, vi } from 'vitest';
import { prepareIngestFiles } from './localFiles';
import { useUiStore } from '../store/uiStore';

describe('prepareIngestFiles', () => {
  it('keeps readable files and reports failed byte reads for retry', async () => {
    const bad = new File(['unavailable'], 'bad.txt');
    vi.spyOn(bad, 'arrayBuffer').mockRejectedValue(new DOMException('Access denied', 'NotReadableError'));
    const toast = vi.spyOn(useUiStore.getState(), 'pushToast');
    const good = new File(['Readable'], 'good.txt');
    const result = await prepareIngestFiles([{ file: bad, path: 'vault/bad.txt' }, { file: good }]);
    expect(result.files.map((file) => file.name)).toEqual(['good.txt']);
    expect(result.failedPaths).toEqual(new Set(['vault/bad.txt']));
    expect(result.deferredPaths.size).toBe(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('vault/bad.txt'), 'warning');
    toast.mockRestore();
  });

  it('sniffs extensionless text files as txt and keeps their bytes', async () => {
    const file = new File(['hello from license'], 'LICENSE', { type: 'text/plain' });
    const { files } = await prepareIngestFiles([{ file }]);
    expect(files).toHaveLength(1);
    expect(files[0].fileType).toBe('txt');
    expect(new TextDecoder().decode(files[0].bytes)).toContain('hello from license');
  });

  it('does not read known binary extensions', async () => {
    const file = new File(['not really a png'], 'image.png', { type: 'image/png' });
    const { files } = await prepareIngestFiles([{ file }]);
    expect(files).toHaveLength(1);
    expect(files[0].fileType).toBe('other');
    expect(files[0].bytes.byteLength).toBe(0);
  });
});
