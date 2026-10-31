import { MAX_INGEST_FILE_BYTES, MAX_INGEST_TOTAL_BYTES } from '../config';
import type { IngestFile } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { lookupLibraryFiles, libraryKey, type LibraryHit } from '../persistence/library';
import { isIngestCandidate, routeFileWithSniff } from './fileRouter';
import { reportReadFailures, type ReadFailure } from './readFailures';
import { holdReload, recoverFromChunkError } from '../util/staleBuild';

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
  /** Transient read errors must retain the last indexed revision and retry. */
  failedPaths: Set<string>;
}

export interface PrepareOptions {
  /**
   * Set by callers that re-scan on a schedule (the folder watcher). Files held
   * back by the batch cap will be picked up on a later pass, so reporting them
   * as skipped would add an ignored-file entry and a warning toast on every
   * poll until the backlog drains.
   */
  deferredWillRetry?: boolean;
  onReadError?: (failure: ReadFailure) => void;
  /**
   * Skip reading files the remembered library already knows by path, size and
   * modified time. They do not count toward the batch size cap, so re-reading a
   * large folder only reads what is new or changed.
   */
  reuseLibrary?: boolean;
}

export async function prepareIngestFiles(
  named: NamedFile[],
  options: PrepareOptions = {},
): Promise<PreparedIngest> {
  const output: IngestFile[] = [];
  const deferredPaths = new Set<string>();
  const failedPaths = new Set<string>();
  const failures: ReadFailure[] = [];
  let totalBytes = 0;
  let totalCapHit = false;

  const identity = (file: File, path?: string) =>
    file.lastModified > 0 && file.size > 0
      ? { path: path ?? file.name, size: file.size, lastModified: file.lastModified }
      : undefined;
  let remembered = new Map<string, LibraryHit>();
  if (options.reuseLibrary) {
    const identities = named
      .map(({ file, path }) => identity(file, path))
      .filter((id): id is NonNullable<typeof id> => id !== undefined);
    remembered = await lookupLibraryFiles(identities);
  }

  for (const { file, path } of named) {
    const known = remembered.size ? identity(file, path) : undefined;
    const hit = known ? remembered.get(libraryKey(known)) : undefined;
    if (hit) {
      output.push({
        fileId: crypto.randomUUID(),
        name: file.name,
        path,
        fileType: hit.fileType,
        bytes: new ArrayBuffer(0),
        lastModified: file.lastModified,
        knownId: hit.docId,
        readBytes: () => file.arrayBuffer(),
      });
      continue;
    }
    const shouldRead = isIngestCandidate(file.name) || file.type.startsWith('audio/');
    if (shouldRead && file.size > MAX_INGEST_FILE_BYTES) {
      useGraphStore.getState().addIgnored(path ?? file.name, `too large (over ${MAX_INGEST_MB} MB)`);
      continue;
    }
    if (shouldRead && totalBytes + file.size > MAX_INGEST_TOTAL_BYTES) {
      // Deferred, not rejected: this file is within the per-file limit and only
      // lost the race for room in this batch.
      deferredPaths.add(path ?? file.name);
      if (!options.deferredWillRetry) {
        useGraphStore
          .getState()
          .addIgnored(path ?? file.name, `selection exceeds ${MAX_INGEST_TOTAL_MB} MB total`);
        if (!totalCapHit) {
          totalCapHit = true;
          useUiStore
            .getState()
            .pushToast(
              `That selection is over the ${MAX_INGEST_TOTAL_MB} MB total limit — the remainder was skipped.`,
              'warning',
            );
        }
      }
      continue;
    }

    let bytes: ArrayBuffer;
    try {
      bytes = shouldRead ? await file.arrayBuffer() : new ArrayBuffer(0);
    } catch (error) {
      const failure = { path: path ?? file.name, error };
      failedPaths.add(failure.path);
      if (options.onReadError) options.onReadError(failure);
      else failures.push(failure);
      continue;
    }
    const fileType = routeFileWithSniff(file.name, bytes, file.type);
    totalBytes += fileType !== null ? bytes.byteLength : 0;
    output.push({
      fileId: crypto.randomUUID(),
      name: file.name,
      path,
      fileType: fileType ?? 'other',
      bytes: fileType !== null ? bytes : new ArrayBuffer(0),
      lastModified: file.lastModified > 0 ? file.lastModified : undefined,
    });
  }
  await reportReadFailures(failures);
  return { files: output, deferredPaths, failedPaths };
}

export async function ingestNamedFiles(named: NamedFile[]): Promise<void> {
  const release = holdReload();
  try {
    // A one-shot selection has no manifest to retry against, so deferred files
    // stay reported-and-skipped exactly as before.
    const { files } = await prepareIngestFiles(named, { reuseLibrary: true });
    if (files.length === 0) {
      // Fully rejected — no run will settle, so snapshot the rejections into
      // the persistent report here.
      const { publishIngestReport } = await import('../pipeline/ingestReport');
      publishIngestReport();
      return;
    }
    const { ingestFiles } = await import('../pipeline/coordinatorLazy');
    await ingestFiles(files);
  } catch (error) {
    console.error('ingestion failed', error);
    if (recoverFromChunkError(error)) return;
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    useUiStore.getState().pushToast(`Those files could not be added${detail}. Try again.`);
  } finally {
    release();
  }
}
