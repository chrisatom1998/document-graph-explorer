import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useChatStore } from '../../store/chatStore';
import { useCorpusStore } from '../../store/corpusStore';
import { IconBulb, IconChat, IconGear, IconHelp, IconHistory, IconPath, IconSearch } from '../icons';
import { DimsToggleButton } from '../DimsToggleButton';
import ResonanceFilters from './ResonanceFilters';
import ConnectedClips from './ConnectedClips';
import CollabMenuItems from './CollabMenuItems';
import './resonance.css';

const GraphNavigator = lazy(() => import('../GraphNavigator'));
const ExportImportMenu = lazy(() => import('../ExportImportMenu'));
const CorpusSwitcher = lazy(() => import('../CorpusSwitcher'));
const SavedViewsSection = lazy(() => import('../SavedViewsSection'));

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
  const [tab, setTab] = useState<Tab>('graph');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const ready = phase === 'ready';

  // Full details follow how a clip was selected. Search, chat citations,
  // insights, paths and the library go through focusNode → commitPendingFocus
  // and expect the reader, so a committed focus opens it; any other selection
  // change (a canvas click, Select in the inspector, clearing) closes it.
  useEffect(() => useUiStore.subscribe((state, prev) => {
    // A committed focus counts even when it re-selects the clip already shown.
    const committedFocus = !!prev.pendingFocus && !state.pendingFocus && state.selectedId === prev.pendingFocus.id;
    if (committedFocus) setDetailsOpen(true);
    else if (state.selectedId !== prev.selectedId) setDetailsOpen(false);
  }), []);
  useEffect(() => { if (tab === 'export' && !ready && phase !== 'idle') setTab('graph'); }, [tab, ready, phase]);

  const ui = () => useUiStore.getState();

  return (
    <div className="rs-root">
      <header className="rs-top">
        <div className="rs-brand">
          <LogoMark />
          <strong>Resonance</strong>
          {/* Switch, create, rename or delete workspaces; the tagline shows until a graph exists. */}
          {docCount > 0
            ? <span className="rs-corpus"><Suspense fallback={<span className="rs-tagline">{activeName}</span>}><CorpusSwitcher /></Suspense></span>
            : <span className="rs-tagline">Find what sounds alike.</span>}
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
          <DimsToggleButton />
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
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); ui().setSettingsOpen(true); }}><IconGear />Settings</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); ui().setHelpOpen(true); }}><IconHelp />Help</button>
                  <hr className="rs-menu__rule" />
                  {/* Camera + filter bookmarks; the classic toolbar's View menu held these. */}
                  <p className="rs-menu__label">Saved views</p>
                  <Suspense fallback={null}><SavedViewsSection onApplied={() => setMoreOpen(false)} /></Suspense>
                  <hr className="rs-menu__rule" />
                  <CollabMenuItems onDone={() => setMoreOpen(false)} />
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

      <ConnectedClips detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen(v => !v)} />
    </div>
  );
}
