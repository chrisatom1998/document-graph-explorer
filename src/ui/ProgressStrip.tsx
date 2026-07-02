import { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import type { FileStage, PipelinePhase } from '../model/types';
import QualityToast from './QualityToast';

const AUTO_HIDE_MS = 2500;
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

  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const [lingering, setLingering] = useState(false);

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

  const active = phase !== 'idle' && phase !== 'ready';
  const visible = active || lingering;

  if (!visible) {
    // Still render QualityToast — it's an independent status affordance
    // that isn't gated on ingestion being in-flight.
    return <QualityToast />;
  }

  const statuses = Object.values(fileStatuses);
  // During enrichment the bar tracks Gemini passes, not file ingestion —
  // a restored session has no fileStatuses at all, and after a live ingest
  // the file count is already at 100%, so it would sit frozen either way.
  const enriching = phase === 'enriching';
  const total = enriching ? enrichProgress?.total ?? 0 : statuses.length;
  const done = enriching
    ? enrichProgress?.done ?? 0
    : statuses.filter((s) => s.stage === 'placed' || s.stage === 'cached').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : phase === 'ready' ? 100 : 0;

  const recentFiles = enriching ? [] : statuses.slice(-MAX_FILE_CHIPS);
  const phaseLabel =
    phase === 'ready'
      ? 'Ready'
      : enriching && enrichProgress?.note
        ? `Enriching — ${enrichProgress.note}`
        : PHASE_LABEL[phase] ?? 'Working…';

  return (
    <div className="progress-strip-layer">
      <div className={`progress-strip glass-panel${!active && lingering ? ' is-leaving' : ''}`}>
        <div className="progress-strip__top">
          <span className="progress-strip__phase">{phaseLabel}</span>
          <div className="progress-strip__bar-track">
            <div className="progress-strip__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-strip__count">
            {done}/{total || 0}
          </span>
        </div>

        {recentFiles.length > 0 && (
          <div className="progress-strip__files">
            {recentFiles.map((f) => (
              <span
                key={f.fileId}
                className={`file-chip stage-${f.stage}`}
                title={f.stage === 'error' ? f.error ?? 'Error' : f.name}
              >
                <span className="file-chip__icon">{STAGE_ICON[f.stage]}</span>
                <span className="file-chip__name">{truncateName(f.name)}</span>
              </span>
            ))}
          </div>
        )}

        {modelProgress && (
          <div className="model-progress">
            <span className="model-progress__label">
              Loading embedding model — {bytesToMB(modelProgress.loaded)} of{' '}
              {bytesToMB(modelProgress.total)} MB… (first time only)
            </span>
            <div className="model-progress__bar-track">
              <div
                className="model-progress__bar-fill"
                style={{
                  width: `${
                    modelProgress.total > 0
                      ? Math.round((modelProgress.loaded / modelProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {ignoredFiles.length > 0 && (
          <div className="ignored-tray">
            <button
              type="button"
              className="ignored-tray__toggle"
              onClick={() => setIgnoredOpen((v) => !v)}
            >
              {ignoredFiles.length} ignored {ignoredOpen ? '▾' : '▸'}
            </button>
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
      <QualityToast />
    </div>
  );
}
