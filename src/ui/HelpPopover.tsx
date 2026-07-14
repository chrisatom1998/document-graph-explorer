import { useRef } from 'react';
import type { EdgeKind } from '../model/types';
import { EDGE_KIND_HEX, EDGE_KIND_LABEL } from '../scene/palette';
import { useUiStore } from '../store/uiStore';
import { FIRST_RUN_GUIDE_REOPEN_EVENT } from './FirstRunGuide';
import { useFocusTrap } from './useFocusTrap';

const EDGE_KINDS = Object.keys(EDGE_KIND_LABEL) as EdgeKind[];

export default function HelpPopover() {
  const open = useUiStore((state) => state.helpOpen);
  const setOpen = useUiStore((state) => state.setHelpOpen);
  const dialogRef = useRef<HTMLElement>(null);
  useFocusTrap(dialogRef, open);

  if (!open) return null;

  const startTour = () => {
    setOpen(false);
    window.dispatchEvent(new Event(FIRST_RUN_GUIDE_REOPEN_EVENT));
  };

  return (
    <div className="settings-backdrop" onMouseDown={() => setOpen(false)}>
      <section
        ref={dialogRef}
        className="help-popover glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Help and graph legend"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-popover__header">
          <div>
            <p className="help-popover__eyebrow">Knowledge Nebula</p>
            <h2 className="help-popover__title">Help &amp; graph legend</h2>
          </div>
          <button
            type="button"
            className="icon-btn-close"
            title="Close help"
            aria-label="Close help"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div className="help-popover__scroll">
          <button type="button" className="btn-pill primary" onClick={startTour}>
            Start guided tour
          </button>

          <section className="help-popover__section" aria-labelledby="help-nodes-title">
            <h3 id="help-nodes-title">Nodes</h3>
            <div className="help-popover__legend-grid">
              <span className="help-node-shape help-node-shape--document" aria-hidden="true" />
              <span><strong>Sphere</strong> — document; size reflects its connections.</span>
              <span className="help-node-shape help-node-shape--topic" aria-hidden="true" />
              <span><strong>Diamond</strong> — topic hub; color groups a cluster.</span>
            </div>
          </section>

          <section className="help-popover__section" aria-labelledby="help-edges-title">
            <h3 id="help-edges-title">Connections</h3>
            <div className="help-popover__edge-list">
              {EDGE_KINDS.map((kind) => (
                <div className="help-popover__edge" key={kind}>
                  <span
                    className="help-popover__edge-swatch"
                    style={{ background: EDGE_KIND_HEX[kind] }}
                    aria-hidden="true"
                  />
                  <span>{EDGE_KIND_LABEL[kind]}</span>
                </div>
              ))}
            </div>
            <p className="help-popover__hint">
              Hover, selection, search, and filters dim unrelated nodes without deleting them.
            </p>
          </section>

          <section className="help-popover__section" aria-labelledby="help-shortcuts-title">
            <h3 id="help-shortcuts-title">Keyboard shortcuts</h3>
            <dl className="help-popover__shortcuts">
              <div><dt><span className="kbd">Ctrl/⌘ K</span></dt><dd>Search documents</dd></div>
              <div><dt><span className="kbd">Arrow keys</span></dt><dd>Pan the graph</dd></div>
              <div><dt><span className="kbd">Tab</span></dt><dd>Reach controls and the graph navigator</dd></div>
              <div><dt><span className="kbd">Enter</span></dt><dd>Open the active search or node result</dd></div>
              <div><dt><span className="kbd">Home</span></dt><dd>Fit the whole graph</dd></div>
              <div><dt><span className="kbd">Esc</span></dt><dd>Close or step back</dd></div>
              <div><dt><span className="kbd">Shift Enter</span></dt><dd>New line in chat</dd></div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}
