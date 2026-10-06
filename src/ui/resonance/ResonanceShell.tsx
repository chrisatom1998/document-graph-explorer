import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useChatStore } from '../../store/chatStore';
import { useCorpusStore } from '../../store/corpusStore';
import { layoutSetDims } from '../../layout/layoutBridge';
import { IconBulb, IconChat, IconCube, IconGear, IconHelp, IconHistory, IconPath, IconSearch } from '../icons';
import ResonanceFilters from './ResonanceFilters';
import ConnectedClips from './ConnectedClips';
import './resonance.css';

const GraphNavigator = lazy(() => import('../GraphNavigator'));
const ExportImportMenu = lazy(() => import('../ExportImportMenu'));
const SidePanel = lazy(() => import('../SidePanel'));

type Tab = 'graph' | 'library' | 'export';

function LogoMark() {
  return (
    <svg className="rs-logo" viewBox="0 0 44 28" aria-hidden="true">
      {[4, 8, 12, 16, 20, 24, 28, 32, 36, 40].map((x, i) => {
        const h = [8, 14, 22, 26, 18, 24, 12, 20, 10, 6][i];
        return <rect key={x} x={x} y={14 - h / 2} width="2.4" height={h} rx="1.2" />;
      })}
    </svg>
  );
}

/**
 * The Resonance workspace: a top bar, filter column and connected-clips
 * inspector laid out around the existing graph renderer (passed as children).
 * Modal panels (search, settings, insights…) stay the fixed overlays they were.
 */
export default function ResonanceShell({ children }: { children: ReactNode }) {
  const phase = useGraphStore(s => s.phase);
  const docCount = useGraphStore(s => s.nodes.filter(n => n.kind === 'document').length);
  const edgeCount = useGraphStore(s => s.edges.length);
  const activeName = useCorpusStore(s => s.activeName);
  const selectedId = useUiStore(s => s.selectedId);
  const dims = useUiStore(s => s.dims);
  const [tab, setTab] = useState<Tab>('graph');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const ready = phase === 'ready';

  // The full side panel is opt-in here (the inspector covers the common case);
  // it closes with the selection so a stale panel never outlives its node.
  useEffect(() => { if (selectedId === null) setDetailsOpen(false); }, [selectedId]);
  // A canvas click only fills the inspector. Search, chat citations, insights,
  // paths and the library go through focusNode → commitPendingFocus, and those
  // callers expect the reader: open the full panel when a pending focus commits.
  useEffect(() => useUiStore.subscribe((state, prev) => {
    if (prev.pendingFocus && !state.pendingFocus && state.selectedId === prev.pendingFocus.id) setDetailsOpen(true);
  }), []);
  useEffect(() => { if (tab === 'export' && !ready && phase !== 'idle') setTab('graph'); }, [tab, ready, phase]);

  const ui = () => useUiStore.getState();
  const toggleDims = () => {
    const next = dims === 2 ? 3 : 2;
    ui().setDims(next);
    layoutSetDims(next);
  };

  return (
    <div className="rs-root">
      <header className="rs-top">
        <div className="rs-brand">
          <LogoMark />
          <strong>Resonance</strong>
          <span className="rs-tagline">{activeName ? activeName : 'Find what sounds alike.'}</span>
        </div>
        <nav className="rs-tabs" aria-label="Views">
          {(['graph', 'library', 'export'] as Tab[]).map(key => (
            <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)} disabled={key === 'library' ? docCount === 0 : key === 'export' ? !(ready || phase === 'idle') : false}>
              {tab === key && <i aria-hidden="true" />}
              {key === 'graph' ? 'Graph' : key === 'library' ? 'Library' : 'Export'}
            </button>
          ))}
        </nav>
        <div className="rs-top__actions">
          <span className="rs-top__status" aria-live="polite">{ready ? `${docCount} nodes · ${edgeCount} links` : docCount ? 'Building your graph…' : ''}</span>
          <span className="rs-top__rule" />
          <button type="button" className="rs-icon" aria-label="Search documents" disabled={!ready} onClick={() => { ui().setSearchResults(null); ui().setSearchOpen(true); }}><IconSearch /></button>
          <button type="button" className="rs-icon" aria-label="Ask about your library" disabled={docCount === 0} onClick={() => useChatStore.getState().setIsOpen(true)}><IconChat /></button>
          <div className="rs-more">
            <button type="button" className="rs-icon rs-icon--round" aria-label="More tools" aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)}><IconGear /></button>
            {moreOpen && (
              <>
                <button type="button" className="rs-scrim" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
                <div className="rs-menu" role="menu">
                  <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreOpen(false); ui().setInsightsOpen(true); }}><IconBulb />Insights</button>
                  <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreOpen(false); ui().setPathMode(true); }}><IconPath />Find a path</button>
                  <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreOpen(false); ui().setSnapshotsOpen(true); }}><IconHistory />Snapshots</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); toggleDims(); }}><IconCube twoD={dims === 2} />{dims === 2 ? 'Switch to 3D' : 'Switch to 2D'}</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); ui().setSettingsOpen(true); }}><IconGear />Settings</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); ui().setHelpOpen(true); }}><IconHelp />Help</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <ResonanceFilters />

      <main className="rs-stage" aria-label="Graph">
        {children}
        {tab === 'library' && (
          <section className="rs-library" aria-label="Library">
            <Suspense fallback={null}><GraphNavigator embedded /></Suspense>
          </section>
        )}
        {tab === 'export' && (
          <section className="rs-export" aria-label="Export and import">
            <Suspense fallback={null}><ExportImportMenu onClose={() => setTab('graph')} /></Suspense>
          </section>
        )}
      </main>

      <ConnectedClips onOpenDetails={() => setDetailsOpen(true)} />
      {detailsOpen && selectedId && <Suspense fallback={null}><SidePanel /></Suspense>}
    </div>
  );
}
