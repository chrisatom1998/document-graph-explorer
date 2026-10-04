import { useEffect, useState, useSyncExternalStore } from 'react';
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

const AUTO_HIDE_MS = 2500;
const IGNORED_LINGER_MS = 6000;
const MAX_FILE_CHIPS = 3;

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
  const [minimized, setMinimized] = useState(false);
  const [lingering, setLingering] = useState(false);

  // True while a cancellable ingest run is live (registered by ingestFiles);
  // false during other active phases (watched-folder rescans, enrichment,
  // embedding rebuilds), where the button would be a dead control.
  const cancellable = useSyncExternalStore(subscribeIngestCancellation, hasCancellableIngest);
  const [cancelRequested, setCancelRequested] = useState(false);
  useEffect(() => {
    // re-arm once the cancelled run has fully wound down
    if (!cancellable) setCancelRequested(false);
  }, [cancellable]);

  // Keep the strip mounted for AUTO_HIDE_MS after the phase reaches 'ready'
  // so it can animate out instead of popping away.
  useEffect(() => {
    if (phase !== 'ready') {
      setLingering(false);
      return;
    }
    setLingering(true);
    const t = setTimeout(() => setLingering(false), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [phase]);

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

  const active = phase !== 'idle' && phase !== 'ready';
  const visible = active || lingering || ignoredFlash;
  useEffect(() => {
    if (!visible) setMinimized(false);
  }, [visible]);

  if (!visible) return null;

  const statuses = Object.values(fileStatuses);
  // During enrichment the bar tracks AI passes, not file ingestion —
  // a restored session has no fileStatuses at all, and after a live ingest
  // the file count is already at 100%, so it would sit frozen either way.
  const enriching = phase === 'enriching';
  const music = modelProgress?.kind === 'music-analysis';
  const total = music ? modelProgress.total : enriching ? enrichProgress?.total ?? 0 : statuses.length;
  const done = music ? modelProgress.loaded : enriching
    ? enrichProgress?.done ?? 0
    : statuses.filter((s) => s.stage === 'placed' || s.stage === 'cached').length;
  const recentFiles = enriching ? [] : statuses.slice(-MAX_FILE_CHIPS);
  const phaseLabel =
    phase === 'ready'
      ? 'Ready'
      : enriching && enrichProgress?.note
        ? `Enriching — ${enrichProgress.note}`
        : music ? 'Analyzing music…' : PHASE_LABEL[phase] ?? 'Working…';
  // total can be 0 when the size probe fails (compressed responses have no
  // usable content-length) — show bytes-only progress rather than "of 0.0 MB".
  const modelMB = modelProgress
    ? modelProgress.total
      ? `${bytesToMB(modelProgress.loaded)} of ${bytesToMB(modelProgress.total)} MB`
      : `${bytesToMB(modelProgress.loaded)} MB`
    : '';
  const taskProgressLabel =
    modelProgress && modelProgress.kind !== 'embedding-model'
      ? modelProgress.note
      : modelProgress
        ? `Loading embedding model — ${modelMB}… (first time only)`
        : '';
  const taskProgressValueText =
    modelProgress?.kind === 'music-analysis'
      ? `${modelProgress.loaded} of ${modelProgress.total} tracks`
      : modelProgress?.kind === 'ocr'
      ? `${modelProgress.loaded} of ${modelProgress.total} pages`
      : modelMB;
  const taskProgressAriaLabel =
    modelProgress?.kind === 'music-analysis' ? 'Analyzing music' : modelProgress?.kind === 'ocr' ? 'Recognizing scanned PDF text' : 'Loading embedding model';

  if (minimized) return (
    <div className="progress-strip-layer progress-strip-layer--minimized">
      <button type="button" className="progress-strip-restore glass-panel"
        aria-label="Show processing details" aria-expanded={false}
        title="Restore processing details. Analysis is still running."
        onClick={() => setMinimized(false)}>
        <span className="progress-strip-restore__status" role="status" aria-live="polite" aria-atomic="true">
          <span className="progress-strip-restore__phase">{phaseLabel}</span>
          {' · '}
          <span className="progress-strip-restore__count">{done}/{total || 0}</span>
        </span>
        {ignoredFiles.length > 0 && <small>{ignoredFiles.length} ignored</small>}
        <span className="progress-strip-restore__label">Expand <span aria-hidden="true">↗</span></span>
      </button>
    </div>
  );

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
            </span>
          </div>
          <div className="progress-strip__actions">
            <button type="button" className="progress-strip__minimize" aria-label="Minimize processing details"
              aria-expanded={true} title="Minimize — processing continues in the background"
              onClick={() => setMinimized(true)}>Minimize <span aria-hidden="true">−</span></button>
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
        </div>

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
            {statuses.length > recentFiles.length && (
              <span className="progress-strip__more-files">+{statuses.length - recentFiles.length} more</span>
            )}
          </div>
        )}

        {modelProgress && (
          <div className="model-progress">
            <span className="model-progress__label">{taskProgressLabel}</span>
            {!music && (
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
            )}
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
