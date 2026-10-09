// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pushToast = vi.hoisted(() => vi.fn());
vi.mock('../store/uiStore', () => ({ useUiStore: { getState: () => ({ pushToast }) } }));
vi.mock('../store/graphStore', () => ({ useGraphStore: { getState: () => ({ phase: 'ready' }) } }));
vi.mock('../store/musicJobs', () => ({ useMusicJobs: { getState: () => ({ jobs: {} }) } }));

const chunkError = new TypeError('Failed to fetch dynamically imported module: /assets/folderIngest-old.js');
let reload: ReturnType<typeof vi.fn>;
let now: number;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  sessionStorage.clear();
  pushToast.mockReset();
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  reload = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
});

afterEach(() => {
  vi.doUnmock('./folderIngest');
  vi.restoreAllMocks();
});

async function select(files: File[] = [new File(['music'], 'clip.wav')]) {
  const { openFolderPicker } = await import('./folderPicker');
  openFolderPicker();
  const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
  return files;
}

async function expectReleased() {
  // Wait for the complete dynamic-import / catch / finally chain.
  await vi.dynamicImportSettled();
  now += 3_000;
  const { recoverFromChunkError } = await import('../util/staleBuild');
  recoverFromChunkError(chunkError);
  expect(reload).toHaveBeenCalledOnce();
}

describe('folder picker reload protection', () => {
  it('holds reload before the lazy module loads and handles its chunk failure without a generic toast', async () => {
    const { recoverFromChunkError, STALE_BUILD_MESSAGE } = await import('../util/staleBuild');
    const ingest = vi.fn().mockRejectedValue(chunkError);
    vi.doMock('./folderIngest', () => {
      // Vite reports the preload error before the import caller can catch it.
      recoverFromChunkError(chunkError);
      return { ingestPickedFolderFiles: ingest };
    });
    await select();
    await vi.waitFor(() => expect(ingest).toHaveBeenCalledOnce());
    await vi.dynamicImportSettled();
    expect(reload).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledExactlyOnceWith(STALE_BUILD_MESSAGE, 'warning');
    await expectReleased();
  });

  it('keeps the lease until ingestion completes, then releases it', async () => {
    let finish!: () => void;
    const ingest = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.doMock('./folderIngest', () => ({ ingestPickedFolderFiles: ingest }));
    const files = await select();
    await vi.waitFor(() => expect(ingest).toHaveBeenCalledWith(files));
    const { recoverFromChunkError } = await import('../util/staleBuild');
    recoverFromChunkError(chunkError);
    expect(reload).not.toHaveBeenCalled();
    finish();
    await expectReleased();
  });

  it('releases the lease on an ordinary ingestion failure and retains its error message', async () => {
    vi.doMock('./folderIngest', () => ({ ingestPickedFolderFiles: vi.fn().mockRejectedValue(new Error('Read failed')) }));
    await select();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith("Couldn't open the folder picker."));
    await expectReleased();
  });

  it('releases the lease if the lazy module itself cannot load', async () => {
    vi.doMock('./folderIngest', () => { throw new Error('Module unavailable'); });
    await select();
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith("Couldn't open the folder picker."));
    await expectReleased();
  });

  it('does not acquire a lease or import ingestion code when selection is cancelled', async () => {
    const loaded = vi.fn();
    vi.doMock('./folderIngest', () => {
      loaded();
      return { ingestPickedFolderFiles: vi.fn() };
    });
    await select([]);
    await expectReleased();
    expect(loaded).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });
});
