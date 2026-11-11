import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useChatStore } from '../../store/chatStore';
import { useCorpusStore } from '../../store/corpusStore';
import { useViewStore, type ResonanceTab } from '../../store/viewStore';
import { openFolderPicker } from '../../ingest/folderPicker';
import { IconBulb, IconChat, IconFit, IconFolderPlus, IconGear, IconHelp, IconHistory, IconNote, IconPath, IconSearch } from '../icons';
import { openSampleAssistant } from '../../store/sampleAssistantStore';
import { DimsToggleButton } from '../DimsToggleButton';
import MusicAnalysisStatusButton from '../MusicAnalysisStatusButton';
import ResonanceFilters from './ResonanceFilters';
import ConnectedClips from './ConnectedClips';
import CollabMenuItems from './CollabMenuItems';
import SnapshotDiffBanner from '../SnapshotDiffBanner';
import { installSinglePlayer } from '../../audio/singlePlayer';
import './resonance.css';
import './forYou.css';

const GraphNavigator = lazy(() => import('../GraphNavigator'));
const ExportImportMenu = lazy(() => import('../ExportImportMenu'));
const CorpusSwitcher = lazy(() => import('../CorpusSwitcher'));
const SavedViewsSection = lazy(() => import('../SavedViewsSection'));
const Minimap = lazy(() => import('../Minimap'));
const ForYou = lazy(() => import('./ForYou'));
const Transport = lazy(() => import('./Transport'));

type Tab = ResonanceTab;
const TAB_LABEL: Record<Tab, string> = { foryou: 'For you', graph: 'Graph', library: 'Library', export: 'Export' };

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
  const graphUsable = useGraphStore(s => s.graphUsable);
  const docCount = useGraphStore(s => s.nodes.filter(n => n.kind === 'document').length);
  const hasAudio = useGraphStore(s => s.nodes.some(n => n.fileType === 'audio'));
  const edgeCount = useGraphStore(s => s.edges.length);
  const activeName = useCorpusStore(s => s.activeName);
  const tab = useViewStore(s => s.tab);
  const setTab = useViewStore(s => s.setTab);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Escape closes the tool menu first (capture phase, ahead of App's global
  // Escape chain) and returns focus to its trigger.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMoreOpen(false);
      document.querySelector<HTMLElement>('.rs-more > .rs-icon')?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [moreOpen]);
  // Any player that starts pauses every other one, in either order (src/audio/singlePlayer.ts).
  useEffect(() => installSinglePlayer(), []);
  const ready = phase === 'ready';
  const usable = graphUsable || ready;
  const refining = graphUsable && (phase === 'embedding' || phase === 'connecting');

  // Full details follow how a clip was selected. Search, chat citations,
  // insights, paths and the library go through focusNode → commitPendingFocus
  // and expect the reader, so a committed focus opens it; any other selection
  // change (a canvas click, Select in the inspector, clearing) closes it.
  useEffect(() => useUiStore.subscribe((state, prev) => {
    // A committed focus counts even when it re-selects the clip already shown.
    const committedFocus = !!prev.pendingFocus && !state.pendingFocus && state.selectedId === prev.pendingFocus.id;
    // Search results, chat citations and insight jumps navigate while For you is up, where the inspector and
    // canvas are not mounted: bring the Graph forward as soon as the navigation starts so it is visible.
    const view = useViewStore.getState();
    const startedFocus = !!state.pendingFocus && state.pendingFocus !== prev.pendingFocus;
    const startedHighlight = state.highlightOwner !== prev.highlightOwner && (state.highlightOwner === 'insights' || state.highlightOwner === 'path');
    if (view.tab === 'foryou' && (startedFocus || committedFocus || startedHighlight)) view.setTab('graph');
    if (committedFocus) setDetailsOpen(true);
    else if (state.selectedId !== prev.selectedId) setDetailsOpen(false);
  }), []);
  useEffect(() => { if (tab === 'export' && !ready && phase !== 'idle') setTab('graph'); }, [tab, ready, phase, setTab]);
  // A restored Library choice from a different workspace cannot apply to an empty one.
  useEffect(() => { if (tab === 'library' && docCount === 0) setTab('foryou'); }, [tab, docCount, setTab]);

  const ui = () => useUiStore.getState();
  // Same camera command as the Home key in App's global key handler.
  const fitGraph = () => ui().sendCamera('fitAll');

  return (
    <div className={`rs-root${docCount === 0 && phase === 'idle' ? ' rs-root--empty' : ''}${tab === 'foryou' ? ' rs-root--foryou' : ''}`}>
      <header className="rs-top">
        <div className="rs-brand">
          <LogoMark />
          <strong>Resonance</strong>
          {/* Switch, create, rename or delete workspaces; the tagline shows until a graph exists. */}
          {docCount > 0
            ? <span className="rs-corpus"><Suspense fallback={<span className="rs-tagline">{activeName}</span>}><CorpusSwitcher /></Suspense></span>
            : <span className="rs-tagline">Sounds and documents</span>}
        </div>
        <nav className="rs-tabs" aria-label="Views">
          {(['foryou', 'graph', 'library', 'export'] as Tab[]).map(key => (
            <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)} disabled={key === 'library' ? docCount === 0 : key === 'export' ? !(ready || phase === 'idle') : false}>
              {tab === key && <i aria-hidden="true" />}
              {TAB_LABEL[key]}
            </button>
          ))}
        </nav>
        <div className="rs-top__actions">
          <button type="button" className="rs-search" aria-label="Search documents: find a sound by feel" aria-keyshortcuts="Control+K Meta+K" aria-disabled={!usable} title={usable ? undefined : 'Add sounds or documents to search them'} onClick={() => { if (!usable) return; ui().setSearchResults(null); ui().setSearchOpen(true); }}>
            <IconSearch /><span>Find a sound by feel</span><kbd aria-hidden="true">⌘K</kbd>
          </button>
          <button type="button" className="rs-addfolder" aria-label="Add a folder" title="Add a folder" onClick={openFolderPicker}><IconFolderPlus /><span>Add a folder</span></button>
          <span className="rs-top__status" role="status" aria-live="polite">{ready ? `${docCount} nodes · ${edgeCount} links` : refining ? 'Refining connections…' : docCount ? 'Building your graph…' : ''}</span>
                    <button type="button" className="rs-icon rs-icon--fit" aria-label="Fit graph to view" aria-keyshortcuts="Home" title="Fit graph to view (Home)" disabled={docCount === 0} onClick={fitGraph}><IconFit /></button>
          {tab !== 'foryou' && <DimsToggleButton />}
          {/* Restores the background audio-analysis notice once it has been minimized. */}
          <MusicAnalysisStatusButton className="rs-icon" />
          {hasAudio && <button type="button" className="rs-icon" aria-label="Sample assistant" title="Sample assistant: search, tag and build crates" aria-haspopup="dialog" onClick={() => openSampleAssistant()}><IconNote /></button>}
          <button type="button" className="rs-icon" aria-label="Ask about your library" disabled={docCount === 0} onClick={() => useChatStore.getState().setIsOpen(true)}><IconChat /></button>
          <div className="rs-more">
            <button type="button" className="rs-icon rs-icon--round" aria-label="More tools" aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)}><IconGear /></button>
            {moreOpen && (
              <>
                <button type="button" className="rs-scrim" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
                <div className="rs-menu" role="menu">
                  <button type="button" role="menuitem" aria-keyshortcuts="Home" title="Fit graph to view (Home)" disabled={docCount === 0} onClick={() => { setMoreOpen(false); fitGraph(); }}><IconFit />Fit graph<kbd className="rs-menu__kbd" aria-hidden="true">Home</kbd></button>
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

      {/* Before any file is added the welcome card is the whole screen. */}
      {!(docCount === 0 && phase === 'idle') && tab !== 'foryou' && <ResonanceFilters />}

      <main className="rs-stage" aria-label={tab === 'foryou' ? 'For you' : 'Graph'}>
        {children}
        {tab === 'foryou' && <Suspense fallback={null}><ForYou /></Suspense>}
        {/* Snapshot compare summary + Clear overlay; kept on the stage, not inside the collapsible filters. */}
        <div className="rs-stage__banner"><SnapshotDiffBanner /></div>
        {/* Orientation aid for larger graphs (it gates itself on MINIMAP_MIN_NODES). Inside
            the stage column it clears the filter column and inspector by construction; it
            unmounts under the Library and Export views rather than floating above them. */}
        {tab === 'graph' && <Suspense fallback={null}><Minimap /></Suspense>}
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

      {!(docCount === 0 && phase === 'idle') && tab !== 'foryou' && <ConnectedClips detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen(v => !v)} />}
      <Suspense fallback={null}><Transport /></Suspense>
    </div>
  );
}
