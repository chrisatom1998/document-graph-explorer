import { openFilePicker } from '../ingest/DropZone';
import { loadDemoCorpus } from '../pipeline/coordinator';
import { useUiStore } from '../store/uiStore';

/**
 * Centered hero shown by App when there are no nodes and the pipeline is
 * idle (spec §8 step 1). Purely presentational; App owns the visibility
 * condition (`!hasNodes && phase === 'idle'`).
 */
export default function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__card glass-panel">
        <h1 className="empty-state__title">Knowledge Nebula</h1>
        <p className="empty-state__tagline">
          Drop your docs. Watch them become a universe.
        </p>
        <div className="empty-state__actions">
          <button
            type="button"
            className="btn-pill"
            onClick={() => {
              openFilePicker();
            }}
          >
            Add files
          </button>
          <button
            type="button"
            className="btn-pill secondary"
            onClick={() => {
              loadDemoCorpus().catch((err) => {
                console.warn('demo corpus load failed', err);
                useUiStore.getState().pushToast("Couldn't load the demo corpus.");
              });
            }}
          >
            Load demo corpus
          </button>
        </div>
        <p className="empty-state__hint">or drag files / folders anywhere</p>
        <p className="empty-state__footer">
          100% local — your documents never leave this browser.
        </p>
      </div>
    </div>
  );
}
