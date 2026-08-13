import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateStorage,
  formatBytes,
  formatStorageSummary,
  storagePressure,
} from './quota';

describe('storagePressure', () => {
  it('is ok below 70%, warn at 70%, critical at 90%', () => {
    expect(storagePressure({ usage: 69, quota: 100 })).toBe('ok');
    expect(storagePressure({ usage: 70, quota: 100 })).toBe('warn');
    expect(storagePressure({ usage: 89, quota: 100 })).toBe('warn');
    expect(storagePressure({ usage: 90, quota: 100 })).toBe('critical');
  });

  it('treats a missing quota as ok', () => {
    expect(storagePressure({ usage: 999, quota: 0 })).toBe('ok');
  });
});

describe('formatBytes / formatStorageSummary', () => {
  it('formats byte sizes with one decimal from KB up', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('summarizes usage against quota', () => {
    expect(formatStorageSummary({ usage: 50 * 1024 * 1024, quota: 100 * 1024 * 1024 })).toBe(
      '50.0 MB of 100.0 MB (50%)',
    );
  });
});

describe('estimateStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when the StorageManager API is absent', async () => {
    vi.stubGlobal('navigator', {});
    await expect(estimateStorage()).resolves.toBeNull();
  });

  it('reads usage and quota from navigator.storage.estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 100 }),
      },
    });
    await expect(estimateStorage()).resolves.toEqual({ usage: 10, quota: 100 });
  });
});
