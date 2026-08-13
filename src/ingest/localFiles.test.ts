import { describe, expect, it } from 'vitest';
import { prepareIngestFiles } from './localFiles';

describe('prepareIngestFiles', () => {
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
