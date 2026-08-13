import { useUiStore } from '../store/uiStore';

/** Banner shown while a snapshot-vs-live visual diff is painted on the graph. */
export default function SnapshotDiffBanner() {
  const overlay = useUiStore((s) => s.snapshotOverlay);
  if (!overlay) return null;

  const clear = () => {
    const ui = useUiStore.getState();
    ui.setSnapshotOverlay(null);
    if (ui.highlightOwner === 'snapshot') ui.setSearchResults(null);
  };

  return (
    <div className="snapshot-diff-banner glass-panel" role="status">
      <div className="snapshot-diff-banner__legend">
        <span className="snapshot-diff-banner__swatch snapshot-diff-banner__swatch--added" /> added
        <span className="snapshot-diff-banner__swatch snapshot-diff-banner__swatch--updated" /> updated
      </div>
      <p className="snapshot-diff-banner__summary">{overlay.summary}</p>
      {overlay.removedLabels.length > 0 && (
        <p className="snapshot-diff-banner__removed">
          Removed: {overlay.removedLabels.slice(0, 8).join(', ')}
          {overlay.removedLabels.length > 8 ? ` +${overlay.removedLabels.length - 8}` : ''}
        </p>
      )}
      <button type="button" className="snapshot-diff-banner__clear" onClick={clear}>
        Clear overlay
      </button>
    </div>
  );
}
