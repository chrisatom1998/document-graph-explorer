/**
 * Browser storage estimate + pressure bands for the Settings quota meter
 * and ingest-time warnings. Pure helpers stay testable without IndexedDB.
 */

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export type StoragePressure = 'ok' | 'warn' | 'critical';

/** Warn when ≥70% of the origin quota is used; critical at ≥90%. */
export const STORAGE_WARN_RATIO = 0.7;
export const STORAGE_CRITICAL_RATIO = 0.9;

export async function estimateStorage(): Promise<StorageEstimate | null> {
  const storage = globalThis.navigator?.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;
  try {
    const result = await storage.estimate();
    return { usage: result.usage ?? 0, quota: result.quota ?? 0 };
  } catch {
    return null;
  }
}

export function storagePressure(estimate: StorageEstimate): StoragePressure {
  if (!Number.isFinite(estimate.quota) || estimate.quota <= 0) return 'ok';
  const ratio = estimate.usage / estimate.quota;
  if (ratio >= STORAGE_CRITICAL_RATIO) return 'critical';
  if (ratio >= STORAGE_WARN_RATIO) return 'warn';
  return 'ok';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatStorageSummary(estimate: StorageEstimate): string {
  const used = formatBytes(estimate.usage);
  const total = formatBytes(estimate.quota);
  if (!Number.isFinite(estimate.quota) || estimate.quota <= 0) return `${used} used`;
  const pct = Math.min(100, Math.round((estimate.usage / estimate.quota) * 100));
  return `${used} of ${total} (${pct}%)`;
}
