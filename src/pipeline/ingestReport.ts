/**
 * Persistent ingest failure report (spec: Phase B #13). The ProgressStrip's
 * ignored tray auto-hides seconds after a run, taking the only record of
 * ignored/failed/skipped/capped files with it. This module snapshots those
 * problems from the graph store whenever an ingest run settles (success,
 * cancellation, or a drop rejected in full before the pipeline even starts),
 * publishes the snapshot as `graphStore.ingestReport`, and persists it on the
 * active corpus record so it survives reloads and corpus switches.
 *
 * Kept free of coordinator/worker imports so UI surfaces (and their jsdom
 * tests) can use it without dragging in pdfjs-dist's DOM globals.
 */

import type {
  FileStatus,
  IngestReport,
  IngestReportEntry,
} from '../model/types';
import { updateCorpusIngestReport } from '../persistence/corpusRepository';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';

const NODE_LIMIT_RE = /node limit/i;

/**
 * Classify the store's current tray state into a report. Returns null when
 * there is nothing to report. Two pruning rules keep it honest:
 * - Node-limit files reach the tray twice (an ignored entry AND an error
 *   status); the "kind|name" dedupe collapses them into one 'capped' entry.
 * - A name that later ingested cleanly (stage placed/cached — e.g. the user
 *   re-added a file that had failed) supersedes its old failure, so the
 *   report self-heals instead of accusing files that are now in the graph.
 */
export function buildIngestReport(
  fileStatuses: Record<string, FileStatus>,
  ignoredFiles: { name: string; reason: string }[],
  options: { cancelled?: boolean; finishedAt: number },
): IngestReport | null {
  const entries: IngestReportEntry[] = [];
  const seen = new Set<string>(); // "kind|name" dedupe keys
  const statuses = Object.values(fileStatuses);
  const succeeded = new Set(
    statuses
      .filter((s) => s.stage === 'placed' || s.stage === 'cached')
      .map((s) => s.name),
  );

  const push = (entry: IngestReportEntry): void => {
    if (succeeded.has(entry.name)) return;
    const key = `${entry.kind}|${entry.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  for (const status of statuses) {
    if (status.stage === 'error') {
      const reason = status.error ?? 'Unknown error';
      push({
        name: status.name,
        reason,
        kind: NODE_LIMIT_RE.test(reason) ? 'capped' : 'failed',
      });
    } else if (
      options.cancelled &&
      (status.stage === 'queued' || status.stage === 'parsing' || status.stage === 'embedding')
    ) {
      push({
        name: status.name,
        reason: 'ingest cancelled before this file finished',
        kind: 'skipped',
      });
    }
  }

  for (const ignored of ignoredFiles) {
    push({
      name: ignored.name,
      reason: ignored.reason,
      kind: NODE_LIMIT_RE.test(ignored.reason) ? 'capped' : 'ignored',
    });
  }

  if (entries.length === 0) return null;
  return { finishedAt: options.finishedAt, entries };
}

/** Write the report to the active corpus record; no-op for ephemeral corpora. */
function persistIngestReport(report: IngestReport | null): void {
  const corpusId = useCorpusStore.getState().activeCorpusId;
  if (!corpusId) return;
  void updateCorpusIngestReport(corpusId, report).catch((err) => {
    // Persistence is best-effort — the in-memory report still works.
    console.warn('[knowledge-nebula] ingest report save failed', err);
  });
}

/**
 * Snapshot the tray into the store's report and persist it, replacing the
 * previous report (a clean run with an empty tray clears it). Called when a
 * run settles; `cancelled` additionally records still-pending files as
 * skipped.
 */
export function publishIngestReport(options: { cancelled?: boolean } = {}): void {
  const state = useGraphStore.getState();
  const report = buildIngestReport(state.fileStatuses, state.ignoredFiles, {
    cancelled: options.cancelled,
    finishedAt: Date.now(),
  });
  state.setIngestReport(report);
  persistIngestReport(report);
}

/** User-initiated dismissal: clears the report AND the tray it derives from. */
export function clearIngestReport(): void {
  const state = useGraphStore.getState();
  state.clearIngestTray();
  state.setIngestReport(null);
  persistIngestReport(null);
}
