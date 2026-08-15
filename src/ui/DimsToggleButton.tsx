/**
 * The 2D/3D dimension switch, shared by the Toolbar and the ingest-time
 * floating toggle below. First-class, not a menu item: it is the primary
 * fallback when the 3D scene struggles (AutoQuality's toast points here),
 * so it stays one click away — including while a corpus is still ingesting.
 *
 * Kept out of the entry chunk (App lazy-loads IngestDimsToggle, Toolbar is
 * itself lazy) — the entry bundle budget has under a kilobyte of headroom.
 */
import { useUiStore } from '../store/uiStore';
import { switchGraphDimensions } from '../scene/dimensionTransition';
import { IconCube } from './icons';

export function DimsToggleButton() {
  const dims = useUiStore((s) => s.dims);
  const handleToggleDims = () => {
    const next = dims === 3 ? 2 : 3;
    switchGraphDimensions(next, { fitAfterSettle: true });
  };
  return (
    <button
      type="button"
      className={`btn-icon${dims === 2 ? ' is-active' : ''}`}
      title={dims === 3 ? 'Switch to 2D' : 'Switch to 3D'}
      aria-label={dims === 3 ? 'Switch to 2D view' : 'Switch to 3D view'}
      aria-pressed={dims === 2}
      onClick={handleToggleDims}
    >
      <IconCube twoD={dims === 2} />
      <span className="toolbar__dims-label" aria-hidden="true">{dims}D</span>
    </button>
  );
}

/**
 * Lone floating dims toggle shown while ingest is still running (the full
 * Toolbar only mounts at phase 'ready'). Sits at the toolbar's default
 * top-center spot so the control appears to persist when the dock arrives.
 */
export default function IngestDimsToggle() {
  return (
    <div className="ingest-dims-toggle glass-panel">
      <DimsToggleButton />
    </div>
  );
}
