import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useCorpusStore } from '../store/corpusStore';

const READ_FAILURE_PREFIX = 'could not read: ';

export interface ReadFailure {
  path: string;
  directory?: boolean;
  error: unknown;
}

/** Include restored reports: a reload must not strand an unchanged failed source. */
export function watchedReadFailurePaths(rootName: string): Set<string> {
  const state = useGraphStore.getState();
  return new Set([
    ...state.ignoredFiles,
    ...(state.ingestReport?.entries.filter((entry) => entry.kind === 'ignored') ?? []),
  ].filter((entry) => entry.reason.startsWith(READ_FAILURE_PREFIX) &&
    (entry.name === rootName || entry.name.startsWith(`${rootName}/`)))
    .map((entry) => entry.name));
}

/** Remove only read errors confirmed recovered by a watch scan, preserving other report entries. */
export async function clearReadFailures(paths: Set<string>): Promise<void> {
  if (paths.size === 0) return;
  const state = useGraphStore.getState();
  const recovered = (entry: { name: string; reason: string }): boolean =>
    paths.has(entry.name) && entry.reason.startsWith(READ_FAILURE_PREFIX);
  const ignoredFiles = state.ignoredFiles.filter((entry) => !recovered(entry));
  const previousReport = state.ingestReport;
  const entries = previousReport?.entries.filter((entry) => entry.kind !== 'ignored' || !recovered(entry));
  useGraphStore.setState({ ignoredFiles });
  if (!previousReport || entries?.length === previousReport.entries.length) return;
  const report = entries?.length ? { finishedAt: Date.now(), entries } : null;
  state.setIngestReport(report);
  const corpusId = useCorpusStore.getState().activeCorpusId;
  if (!corpusId) return;
  const { updateCorpusIngestReport } = await import('../persistence/corpusRepository');
  await updateCorpusIngestReport(corpusId, report).catch((error: unknown) => {
    console.warn('[knowledge-nebula] ingest report save failed', error);
  });
}

export async function reportReadFailures(failures: ReadFailure[]): Promise<void> {
  if (failures.length === 0) return;
  // A fresh read failure supersedes successes from earlier scans. Otherwise
  // report pruning would hide this failure behind an old cached/placed status.
  useGraphStore.setState((state) => ({
    fileStatuses: Object.fromEntries(Object.entries(state.fileStatuses).filter(([, status]) => {
      const path = status.path ?? status.name;
      return !failures.some((failure) => path === failure.path ||
        (failure.directory && path.startsWith(`${failure.path}/`)));
    })),
  }));
  for (const failure of failures) {
    const detail = failure.error instanceof Error ? failure.error.message : String(failure.error);
    useGraphStore.getState().addIgnored(failure.path, `${READ_FAILURE_PREFIX}${detail}`);
  }
  const first = failures[0].path;
  useUiStore.getState().pushToast(
    `Could not read “${first}”${failures.length > 1 ? ` and ${failures.length - 1} other paths` : ''}. Other readable files were processed; retry after checking access.`,
    'warning',
  );
  const { publishIngestReport } = await import('../pipeline/ingestReport');
  publishIngestReport();
}
