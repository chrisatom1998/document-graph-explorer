/**
 * "Last ingest issues" section of the Insights panel: the persistent surface
 * for the ignored/failed/skipped/capped files that the ProgressStrip's tray
 * only shows for a few seconds. Backed by graphStore.ingestReport, which the
 * pipeline publishes when a run settles and persists per corpus.
 *
 * Separate from InsightsPanel so the jsdom test renders just this section.
 */

import { openFilePicker } from '../ingest/DropZone';
import { clearIngestReport } from '../pipeline/ingestReport';
import { useGraphStore } from '../store/graphStore';
import { timeAgo } from '../util/relativeTime';

export default function IngestReportSection() {
  const report = useGraphStore((s) => s.ingestReport);
  if (!report || report.entries.length === 0) return null;

  return (
    <>
      <div className="insights__section">
        <div className="insights__section-head">
          <p className="side-panel__section-label">
            Last ingest issues ({report.entries.length})
          </p>
          <button
            type="button"
            className="insights__highlight-btn"
            title="Dismiss this report — it will not come back until another ingest has issues"
            onClick={clearIngestReport}
          >
            Clear
          </button>
        </div>
        <p className="insights__hint">
          From the last ingest ({timeAgo(report.finishedAt)}) — kept here after the
          progress strip hides, and across reloads.
        </p>
        {report.entries.map((entry, i) => (
          <div
            className="ingest-report__row"
            key={`${entry.kind}|${entry.name}|${i}`}
            title={`${entry.name} — ${entry.reason}`}
          >
            <span className={`ingest-report__kind is-${entry.kind}`}>{entry.kind}</span>
            <span className="ingest-report__name">{entry.name}</span>
            <span className="ingest-report__reason">{entry.reason}</span>
          </div>
        ))}
        <button
          type="button"
          className="insights__row"
          title="Open the file picker to add these files again — a clean re-ingest removes them from this report"
          onClick={() => openFilePicker()}
        >
          ↻ Re-add files…
        </button>
      </div>
      <hr className="hairline" />
    </>
  );
}
