import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Chip } from '@heroui/react/chip';
import { ProgressBar } from '@heroui/react/progress-bar';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import {
  cancelIngest,
  hasCancellableIngest,
  subscribeIngestCancellation,
} from '../pipeline/ingestCancellation';
import type { FileStage, PipelinePhase } from '../model/types';
import { estimateRemainingMs, formatEta } from './graphReadability';

const AUTO_HIDE_MS = 2500;
const ERROR_HOLD_MS = 12_000;
const IGNORED_LINGER_MS = 6000;
const MAX_FILE_CHIPS = 7;

const PHASE_LABEL: Partial<Record<PipelinePhase, string>> = {
  parsing: 'Parsing…',
  linking: 'Finding connections…',
  embedding: 'Embedding meaning…',
  connecting: 'Clustering…',
  enriching: 'Enriching…',
};

const STAGE_ICON: Record<FileStage, string> = {
  queued: '◌',
  parsing: '⟳',
  embedding: '✦',
  placed: '✓',
  cached: '⚡',
  error: '✕',
};

function bytesToMB(n: number): string {
  return (n / (1024 * 1024)).toFixed(1);
}

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

export default function ProgressStrip() {
  const phase = useGraphStore((s) => s.phase);
  const fileStatuses = useGraphStore((s) => s.fileStatuses);
  const ignoredFiles = useGraphStore((s) => s.ignoredFiles);
  const modelProgress = useGraphStore((s) => s.modelProgress);
  const enrichProgress = useGraphStore((s) => s.enrichProgress);
  const ingestReport = useGraphStore((s) => s.ingestReport);
  const setInsightsOpen = useUiStore((s) => s.setInsightsOpen);

  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [lingering, setLingering] = useState(false);
  const [holdErrors, setHoldErrors] = useState(false);
  const [clock, setClock] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  // True while a cancellable ingest run is live (registered by ingestFiles);
  // false during other active phases (watched-folder rescans, enrichment,
  // embedding rebuilds), where the button would be a dead control.
  const cancellable = useSyncExternalStore(subscribeIngestCancellation, hasCancellableIngest);
  const [cancelRequested, setCancelRequested] = useState(false);
  useEffect(() => {
    // re-arm once the cancelled run has fully wound down
    if (!cancellable) setCancelRequested(false);
  }, [cancellable]);

  // Keep the strip mounted after 'ready' so it can animate out. Failed files
  // hold the command center longer so retry stays reachable.
  useEffect(() => {
    if (phase !== 'ready') {
      setLingering(false);
      setHoldErrors(false);
      return;
    }
    const hasErrors = Object.values(useGraphStore.getState().fileStatuses).some(
      (status) => status.stage === 'error',
    );
    setLingering(true);
    setHoldErrors(hasErrors);
    const t = setTimeout(() => {
      setLingering(false);
      setHoldErrors(false);
    }, hasErrors ? ERROR_HOLD_MS : AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const active = phase !== 'idle' && phase !== 'ready';

  useEffect(() => {
    if (!active) {
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current ??= performance.now();
    const timer = window.setInterval(() => setClock(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  // A drop that is rejected in full (e.g. every file too large) never starts
  // the pipeline, so without this the rejection would be completely silent.
  // Separate from `lingering` because that state carries the fade-out class.
  const [ignoredFlash, setIgnoredFlash] = useState(false);
  useEffect(() => {
    if (ignoredFiles.length === 0) return;
    setIgnoredFlash(true);
    setIgnoredOpen(true);
    const t = setTimeout(() => {
      setIgnoredFlash(false);
      setIgnoredOpen(false);
    }, IGNORED_LINGER_MS);
    return () => clearTimeout(t);
  }, [ignoredFiles.length]);

  const visible = active || lingering || holdErrors || ignoredFlash;
  const statuses = Object.values(fileStatuses);
  const stageCounts = useMemo(() => {
    const counts = { queued: 0, parsing: 0, embedding: 0, error: 0 };
    for (const status of statuses) {
      if (status.stage in counts) counts[status.stage as keyof typeof counts] += 1;
    }
    return counts;
  }, [statuses]);
  const failedFiles = useMemo(
    () => statuses.filter((status) => status.stage === 'error'),
    [statuses],
  );

  if (!visible) return null;
  // During enrichment the bar tracks AI passes, not file ingestion —
  // a restored session has no fileStatuses at all, and after a live ingest
  // the file count is already at 100%, so it would sit frozen either way.
  const enriching = phase === 'enriching';
  const total = enriching ? enrichProgress?.total ?? 0 : statuses.length;
  const done = enriching
    ? enrichProgress?.done ?? 0
    : statuses.filter((s) => s.stage === 'placed' || s.stage === 'cached').length;
  const recentFiles = enriching ? [] : statuses.slice(-MAX_FILE_CHIPS);
  const phaseLabel =
    phase === 'ready'
      ? 'Ready'
      : enriching && enrichProgress?.note
        ? `Enriching — ${enrichProgress.note}`
        : PHASE_LABEL[phase] ?? 'Working…';
  // total can be 0 when the size probe fails (compressed responses have no
  // usable content-length) — show bytes-only progress rather than "of 0.0 MB".
  const modelMB = modelProgress
    ? modelProgress.total
      ? `${bytesToMB(modelProgress.loaded)} of ${bytesToMB(modelProgress.total)} MB`
      : `${bytesToMB(modelProgress.loaded)} MB`
    : '';
  const taskProgressLabel =
    modelProgress?.kind === 'ocr'
      ? modelProgress.note
      : modelProgress
        ? `Loading embedding model — ${modelMB}… (first time only)`
        : '';
  const taskProgressValueText =
    modelProgress?.kind === 'ocr'
      ? `${modelProgress.loaded} of ${modelProgress.total} pages`
      : modelMB;
  const taskProgressAriaLabel =
    modelProgress?.kind === 'ocr' ? 'Recognizing scanned PDF text' : 'Loading embedding model';

  const elapsedMs = startedAtRef.current ? Math.max(0, clock - startedAtRef.current) : 0;
  const remainingMs = enriching
    ? estimateRemainingMs(done, total, elapsedMs)
    : estimateRemainingMs(done, total, elapsedMs);
  const etaLabel = remainingMs !== null ? formatEta(remainingMs) : '';

  const retryFailed = () => {
    void import('../ingest/DropZone').then(({ openFilePicker }) => openFilePicker());
  };

  return (
    <div className="progress-strip-layer">
      <div
        className={`progress-strip glass-panel${
          !active && lingering && !ignoredFlash ? ' is-leaving' : ''
        }`}
        aria-busy={active}
      >
        <div className="progress-strip__top">
          {/* the live region wraps only the phase/progress text — the Cancel
              button sits outside it so its label flip doesn't re-announce */}
          <div
            className="progress-strip__status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="progress-strip__phase">{phaseLabel}</span>
            <ProgressBar
              className="progress-strip__progress"
              aria-label={phaseLabel}
              minValue={0}
              maxValue={total || 1}
              value={total > 0 ? done : 0}
              valueLabel={total > 0 ? `${done} of ${total}` : phaseLabel}
            >
              <ProgressBar.Track className="progress-strip__bar-track">
                <ProgressBar.Fill className="progress-strip__bar-fill" />
              </ProgressBar.Track>
            </ProgressBar>
            <span className="progress-strip__count">
              {done}/{total || 0}
              {etaLabel ? ` · ${etaLabel}` : ''}
            </span>
          </div>
          {active && cancellable && (
            <button
              type="button"
              className="progress-strip__cancel"
              disabled={cancelRequested}
              title="Stop this ingest — documents already placed stay in the graph"
              onClick={() => {
                setCancelRequested(true);
                cancelIngest();
              }}
            >
              {cancelRequested ? 'Cancelling…' : 'Cancel'}
            </button>
          )}
        </div>

        {!enriching && (stageCounts.parsing > 0 || stageCounts.embedding > 0 || stageCounts.queued > 0 || failedFiles.length > 0) && (
          <div className="progress-strip__stages" aria-label="Ingest stages">
            {stageCounts.queued > 0 && <span>{stageCounts.queued} queued</span>}
            {stageCounts.parsing > 0 && <span>{stageCounts.parsing} parsing</span>}
            {stageCounts.embedding > 0 && <span>{stageCounts.embedding} embedding</span>}
            {failedFiles.length > 0 && <span className="progress-strip__stage-error">{failedFiles.length} failed</span>}
          </div>
        )}

        {recentFiles.length > 0 && (
          <div className="progress-strip__files">
            {recentFiles.map((f) => (
              <Chip
                key={f.fileId}
                className={`file-chip stage-${f.stage}`}
                title={f.stage === 'error' ? f.error ?? 'Error' : f.name}
                size="sm"
                variant="secondary"
              >
                <span className="file-chip__icon">{STAGE_ICON[f.stage]}</span>
                <span className="file-chip__name">{truncateName(f.name)}</span>
              </Chip>
            ))}
          </div>
        )}

        {modelProgress && (
          <div className="model-progress">
            <span className="model-progress__label">{taskProgressLabel}</span>
            <ProgressBar
              className="model-progress__progress"
              aria-label={taskProgressAriaLabel}
              minValue={0}
              maxValue={Math.max(1, modelProgress.total)}
              value={modelProgress.loaded}
              valueLabel={taskProgressValueText}
            >
              <ProgressBar.Track className="model-progress__bar-track">
                <ProgressBar.Fill className="model-progress__bar-fill" />
              </ProgressBar.Track>
            </ProgressBar>
          </div>
        )}

        {failedFiles.length > 0 && (
          <div className="progress-strip__failures">
            <div className="progress-strip__failures-head">
              <span>{failedFiles.length} file{failedFiles.length === 1 ? '' : 's'} failed</span>
              <button
                type="button"
                className="progress-strip__retry"
                title="Re-select the failed files to try ingesting them again"
                onClick={retryFailed}
              >
                Retry failed
              </button>
            </div>
            <ul className="progress-strip__failure-list">
              {failedFiles.slice(0, 4).map((file) => (
                <li key={file.fileId} title={file.error ?? 'Error'}>
                  {truncateName(file.name, 28)}
                  {file.error ? ` — ${file.error}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ignoredFiles.length > 0 && (
          <div className="ignored-tray">
            <div className="ignored-tray__actions">
              <button
                type="button"
                className="ignored-tray__toggle"
                title="Show or hide the files that were skipped during ingestion"
                onClick={() => setIgnoredOpen((v) => !v)}
              >
                {ignoredFiles.length} ignored {ignoredOpen ? '▾' : '▸'}
              </button>
              {ingestReport && (
                <button
                  type="button"
                  className="ignored-tray__toggle"
                  title="Open the full ingest report in the Insights panel — it stays available after this strip hides"
                  onClick={() => setInsightsOpen(true)}
                >
                  View full report
                </button>
              )}
            </div>
            {ignoredOpen && (
              <div className="ignored-tray__list">
                {ignoredFiles.map((f, i) => (
                  <div className="ignored-tray__row" key={`${f.name}-${i}`}>
                    <span>{f.name}</span>
                    <span className="ignored-tray__row-reason">{f.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
