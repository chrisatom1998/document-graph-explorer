import { MAX_INGEST_FILE_BYTES, MAX_INGEST_TOTAL_BYTES } from '../config';
import type { IngestFile } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { routeFile } from './fileRouter';

export interface NamedFile {
  file: File;
  /** Relative path for folders; omitted for a top-level file selection. */
  path?: string;
}

const MAX_INGEST_MB = Math.round(MAX_INGEST_FILE_BYTES / (1024 * 1024));
const MAX_INGEST_TOTAL_MB = Math.round(MAX_INGEST_TOTAL_BYTES / (1024 * 1024));

export interface PreparedIngest {
  files: IngestFile[];
  /**
   * Paths held back only because this batch hit the total-size cap — not
   * because the file itself is unusable. A caller that tracks the source (the
   * folder watcher) must retry these rather than record them as processed.
   */
  deferredPaths: Set<string>;
}

export async function prepareIngestFiles(named: NamedFile[]): Promise<PreparedIngest> {
  const output: IngestFile[] = [];
  const deferredPaths = new Set<string>();
  let totalBytes = 0;
  let totalCapHit = false;

  for (const { file, path } of named) {
    const fileType = routeFile(file.name);
    if (fileType !== null && file.size > MAX_INGEST_FILE_BYTES) {
      useGraphStore.getState().addIgnored(file.name, `too large (over ${MAX_INGEST_MB} MB)`);
      continue;
    }
    if (fileType !== null && totalBytes + file.size > MAX_INGEST_TOTAL_BYTES) {
      useGraphStore
        .getState()
        .addIgnored(file.name, `selection exceeds ${MAX_INGEST_TOTAL_MB} MB total`);
      // Deferred, not rejected: this file is within the per-file limit and only
      // lost the race for room in this batch.
      deferredPaths.add(path ?? file.name);
      if (!totalCapHit) {
        totalCapHit = true;
        useUiStore
          .getState()
          .pushToast(
            `That selection is over the ${MAX_INGEST_TOTAL_MB} MB total limit — the remainder was skipped.`,
            'warning',
          );
      }
      continue;
    }

    const bytes = fileType !== null ? await file.arrayBuffer() : new ArrayBuffer(0);
    totalBytes += bytes.byteLength;
    output.push({
      fileId: crypto.randomUUID(),
      name: file.name,
      path,
      fileType: fileType ?? 'other',
      bytes,
      lastModified: file.lastModified > 0 ? file.lastModified : undefined,
    });
  }
  return { files: output, deferredPaths };
}

export async function ingestNamedFiles(named: NamedFile[]): Promise<void> {
  try {
    // A one-shot selection has no manifest to retry against, so deferred files
    // stay reported-and-skipped exactly as before.
    const { files } = await prepareIngestFiles(named);
    if (files.length === 0) return;
    const { ingestFiles } = await import('../pipeline/coordinatorLazy');
    await ingestFiles(files);
  } catch (error) {
    console.error('ingestion failed', error);
    useUiStore
      .getState()
      .pushToast("Something went wrong adding those files — check the console for details.");
  }
}
