import { describe, expect, it, vi } from 'vitest';
import { prepareIngestFiles } from './localFiles';
import { libraryKey } from '../persistence/library';

const library = vi.hoisted(() => ({ lookupLibraryFiles: vi.fn() }));
vi.mock('../persistence/library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../persistence/library')>()),
  lookupLibraryFiles: library.lookupLibraryFiles,
}));
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

  it.each([['loop.wav', ''], ['loop.WAV', 'audio/x-wav'], ['loop.bin', 'audio/wav']])('preserves WAV bytes for %s', async (name, type) => {
    const file = new File([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])], name, { type });
    const { files } = await prepareIngestFiles([{ file }]);
    expect(files[0].fileType).toBe('audio');
    expect(files[0].bytes.byteLength).toBe(12);
  });

  it('does not read known binary extensions', async () => {
    const file = new File(['not really a png'], 'image.png', { type: 'image/png' });
    const { files } = await prepareIngestFiles([{ file }]);
    expect(files).toHaveLength(1);
    expect(files[0].fileType).toBe('other');
    expect(files[0].bytes.byteLength).toBe(0);
  });
});

describe('prepareIngestFiles with the remembered library', () => {
  const track = (name: string, body = 'RIFF....WAVE') => new File([body], name, { type: 'audio/wav', lastModified: 1_700_000_000_000 });

  it('skips reading unchanged files and keeps them out of the size cap', async () => {
    const kept = track('kept.wav');
    const fresh = track('fresh.wav');
    const read = vi.spyOn(kept, 'arrayBuffer');
    library.lookupLibraryFiles.mockResolvedValue(new Map([
      [libraryKey({ path: 'Crate/kept.wav', size: kept.size, lastModified: kept.lastModified }), { docId: 'doc-kept', fileType: 'audio' }],
    ]));
    const { files } = await prepareIngestFiles(
      [{ file: kept, path: 'Crate/kept.wav' }, { file: fresh, path: 'Crate/fresh.wav' }],
      { reuseLibrary: true },
    );
    expect(library.lookupLibraryFiles).toHaveBeenCalledWith([
      { path: 'Crate/kept.wav', size: kept.size, lastModified: kept.lastModified },
      { path: 'Crate/fresh.wav', size: fresh.size, lastModified: fresh.lastModified },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(files[0]).toMatchObject({ name: 'kept.wav', knownId: 'doc-kept', fileType: 'audio', lastModified: kept.lastModified });
    expect(files[0].bytes.byteLength).toBe(0);
    expect(new TextDecoder().decode(await files[0].readBytes!())).toBe('RIFF....WAVE');
    expect(files[1].knownId).toBeUndefined();
    expect(files[1].bytes.byteLength).toBe(fresh.size);
  });

  it('treats a changed size or date as a new file', async () => {
    const edited = track('edited.wav', 'RIFF....WAVE plus more');
    library.lookupLibraryFiles.mockResolvedValue(new Map([
      [libraryKey({ path: 'edited.wav', size: 12, lastModified: edited.lastModified }), { docId: 'old', fileType: 'audio' }],
    ]));
    const { files } = await prepareIngestFiles([{ file: edited }], { reuseLibrary: true });
    expect(files[0].knownId).toBeUndefined();
    expect(files[0].bytes.byteLength).toBe(edited.size);
  });

  it('does not consult the library unless asked', async () => {
    library.lookupLibraryFiles.mockClear();
    await prepareIngestFiles([{ file: track('watched.wav') }]);
    expect(library.lookupLibraryFiles).not.toHaveBeenCalled();
  });
});
