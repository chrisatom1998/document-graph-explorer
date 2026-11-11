import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { DocNode } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { useChatStore } from '../../store/chatStore';
import { openSampleAssistant } from '../../store/sampleAssistantStore';
import { IconBulb, IconChat, IconFit, IconGear, IconHelp, IconHistory, IconNote, IconPath, IconSearch } from '../../ui/icons';
import { DimsToggleButton } from '../../ui/DimsToggleButton';
import MusicAnalysisStatusButton from '../../ui/MusicAnalysisStatusButton';
import ConnectedClips from '../../ui/resonance/ConnectedClips';
import CollabMenuItems from '../../ui/resonance/CollabMenuItems';
import SnapshotDiffBanner from '../../ui/SnapshotDiffBanner';
import { Chips, CoverArt, PlayButton, Scrubber, TagChips, TransportGlyph, shade } from '../music/parts';
import { clipColor, clipFacts, clock } from '../music/library';
import { addFiles, addFolder, openSearch, playClip, selectClip, skip, togglePlayback, usePlayerStore } from '../music/player';
import { useDemoLoader, useLibrary } from '../music/useLibrary';
import '../../ui/resonance/resonance.css';
import '../music/music-base.css';
import './night.css';

const GraphNavigator = lazy(() => import('../../ui/GraphNavigator'));
const ExportImportMenu = lazy(() => import('../../ui/ExportImportMenu'));
const CorpusSwitcher = lazy(() => import('../../ui/CorpusSwitcher'));
const SavedViewsSection = lazy(() => import('../../ui/SavedViewsSection'));
const Minimap = lazy(() => import('../../ui/Minimap'));
const ResonanceFilters = lazy(() => import('../../ui/resonance/ResonanceFilters'));

type View = 'graph' | 'library' | 'export';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function importGraph(): void {
  void import('../../ui/ExportImportMenu').then(({ importGraphJsonFileWithToast, openGraphJsonPicker }) => {
    openGraphJsonPicker((file) => { void importGraphJsonFileWithToast(file); });
  }).catch((error) => {
    console.warn('graph import tools failed to load', error);
    useUiStore.getState().pushToast("Couldn't open the graph importer.");
  });
}

function Tile({ node, active }: { node: DocNode; active: boolean }) {
  return (
    <li className={`ns-tile${active ? ' is-active' : ''}`}>
      <button type="button" className="ns-tile__open" onClick={() => selectClip(node.id)} aria-label={`Open ${node.title}`} />
      <span className="ns-tile__art"><CoverArt node={node} radius={6} /><PlayButton node={node} className="ns-tile__play" onPlay={() => selectClip(node.id)} /></span>
      <strong>{node.title}</strong>
      <Chips node={node} />
    </li>
  );
}

/** Night Session workspace: library, sound map, now-playing panel and a persistent player. */
export default function NightShell({ graph }: { graph: ReactNode }) {
  const phase = useGraphStore(s => s.phase);
  const graphUsable = useGraphStore(s => s.graphUsable);
  const docCount = useGraphStore(s => s.nodes.filter(n => n.kind === 'document').length);
  const edgeCount = useGraphStore(s => s.edges.length);
  const hasAudio = useGraphStore(s => s.nodes.some(n => n.fileType === 'audio'));
  const { docs, audio, selected, focus, neighbors, empty } = useLibrary();
  const demo = useDemoLoader();
  const [view, setView] = useState<View>('graph');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const playingId = usePlayerStore(s => s.currentId);
  const isPlaying = usePlayerStore(s => s.playing);
  const progress = usePlayerStore(s => s.progress);
  const nowNode = docs.find(d => d.id === playingId) ?? focus;
  const color = focus ? clipColor(focus) : '#1ed760';
  const facts = focus ? clipFacts(focus) : null;
  const ready = phase === 'ready';
  const usable = graphUsable || ready;
  const refining = graphUsable && (phase === 'embedding' || phase === 'connecting');
  const status = ready ? `${docCount} nodes · ${edgeCount} links` : refining ? 'Refining connections…' : docCount ? 'Building your graph…' : '';

  useEffect(() => useUiStore.subscribe((state, prev) => {
    const committedFocus = !!prev.pendingFocus && !state.pendingFocus && state.selectedId === prev.pendingFocus.id;
    if (committedFocus) setDetailsOpen(true);
    else if (state.selectedId !== prev.selectedId) setDetailsOpen(false);
  }), []);

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

  const fitGraph = () => useUiStore.getState().sendCamera('fitAll');
  const showLibrary = () => {
    setView('library');
    document.querySelector('.graph-navigator')?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className={`mx-shell ns-root${empty ? ' ns-root--empty' : ''}`}>
      <header className="rs-top ns-header">
        <span className="ns-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" /><path d="M6 10v4M9.5 7v10M13 9v6M16.5 6v12" /></svg>
          Resonance
        </span>
        <span className="rs-corpus"><Suspense fallback={null}><CorpusSwitcher /></Suspense></span>
        <span className="rs-top__status" role="status">{status}</span>
        <div className="ns-views" role="group" aria-label="Views">
          <button type="button" aria-current={view === 'graph' ? 'page' : undefined} onClick={() => setView('graph')}>Graph</button>
          <button type="button" aria-current={view === 'library' ? 'page' : undefined} onClick={showLibrary}>Library</button>
          <button type="button" aria-current={view === 'export' ? 'page' : undefined} onClick={() => setView('export')}>Export</button>
        </div>
        <div className="rs-top__actions">
          <button type="button" className="rs-icon" aria-label="Search documents" disabled={!usable} onClick={openSearch}><IconSearch /></button>
          <button type="button" className="rs-icon" aria-label="Fit graph to view" aria-keyshortcuts="Home" title="Fit graph to view (Home)" disabled={docCount === 0} onClick={fitGraph}><IconFit /></button>
          <DimsToggleButton />
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
                  <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreOpen(false); useUiStore.getState().setInsightsOpen(true); }}><IconBulb />Insights</button>
                  <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreOpen(false); useUiStore.getState().setPathMode(true); }}><IconPath />Find a path</button>
                  <button type="button" role="menuitem" disabled={!ready} onClick={() => { setMoreOpen(false); useUiStore.getState().setSnapshotsOpen(true); }}><IconHistory />Snapshots</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); useUiStore.getState().setSettingsOpen(true); }}><IconGear />Settings</button>
                  <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); useUiStore.getState().setHelpOpen(true); }}><IconHelp />Help</button>
                  <hr className="rs-menu__rule" />
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

      <aside className="ns-library" aria-label="Your library">
        {docs.length > 0 && <Suspense fallback={null}><GraphNavigator embedded /></Suspense>}
        {!empty && <Suspense fallback={null}><ResonanceFilters /></Suspense>}
      </aside>

      <main className="ns-main" aria-label="Graph" style={{ '--ns-hero': shade(color, -0.25) } as React.CSSProperties}>
        {empty ? (
          <section className="ns-welcome" aria-label="Welcome">
            <p className="ns-eyebrow">{greeting()}</p>
            <h1>Your sounds, mapped by how they sound.</h1>
            <p className="ns-lede">Tempo, key and character are found on this device. Nothing is uploaded.</p>
            <div className="ns-starts">
              <button type="button" className="ns-start ns-start--primary" disabled={demo.busy !== null} onClick={() => demo.start('audio')}>
                <span className="ns-start__art ns-start__art--a" aria-hidden="true" />
                <strong>{demo.busy === 'audio' ? 'Loading sample pack…' : 'Play the sample pack'}</strong><small>8 generated loops and one-shots</small>
              </button>
              <button type="button" className="ns-start" onClick={addFiles}>
                <span className="ns-start__art ns-start__art--b" aria-hidden="true" />
                <strong>Add your sounds</strong><small>WAV, MP3, FLAC, AIFF and more</small>
              </button>
              <button type="button" className="ns-start" onClick={addFolder}>
                <span className="ns-start__art ns-start__art--c" aria-hidden="true" />
                <strong>Add a folder</strong><small>Includes subfolders</small>
              </button>
              <button type="button" className="ns-start" aria-label="Load demo corpus" disabled={demo.busy !== null} onClick={() => demo.start('docs')}>
                <span className="ns-start__art ns-start__art--d" aria-hidden="true" />
                <strong>{demo.busy === 'docs' ? 'Loading documents…' : 'Document demo'}</strong><small>100 sample PDFs and notes</small>
              </button>
            </div>
            <button type="button" className="ns-text-btn" onClick={importGraph}>Import a graph</button>
          </section>
        ) : (
          <>
            {focus && facts && (
              <header className="ns-hero">
                <CoverArt node={focus} radius={6} className="ns-hero__art" />
                <div className="ns-hero__text">
                  <p className="ns-eyebrow">{selected ? facts.kind : `Featured ${facts.kind.toLowerCase()}`}</p>
                  <h1>{focus.title}</h1>
                  <p className="ns-hero__meta">
                    <Chips node={focus} />
                    <span>{neighbors.length} similar {neighbors.length === 1 ? 'sound' : 'sounds'}</span>
                  </p>
                </div>
              </header>
            )}
            {focus?.fileType === 'audio' && (
              <div className="ns-actions">
                <button type="button" className="ns-bigplay" aria-label={isPlaying && playingId === focus.id ? `Pause ${focus.title}` : `Play ${focus.title}`} onClick={() => { if (!selected) selectClip(focus.id); playClip(focus.id); }}>
                  <TransportGlyph kind={isPlaying && playingId === focus.id ? 'pause' : 'play'} />
                </button>
              </div>
            )}
            {focus && <TagChips node={focus} className="ns-tags-inline" />}
            <div className="ns-body">
              <section className="ns-map" aria-label="Sound Map">
                <header className="mx-map__head">
                  <span className="mx-map__titles"><strong>Sound Map</strong><small>Closer means more alike. Click a dot to open it.</small></span>
                </header>
                <div className="mx-map__slot">
                  {view === 'graph' && <Suspense fallback={null}><Minimap /></Suspense>}
                  <SnapshotDiffBanner />
                  {graph}
                </div>
                {view === 'export' && (
                  <div className="ns-export" aria-label="Export and import">
                    <Suspense fallback={null}><ExportImportMenu onClose={() => setView('graph')} /></Suspense>
                  </div>
                )}
              </section>
              {neighbors.length > 0 && (
                <section className="ns-shelf" aria-label="Similar sounds">
                  <h2>Similar sounds</h2>
                  <ul className="ns-tiles">{neighbors.map(n => <Tile key={n.node.id} node={n.node} active={selected?.id === n.node.id} />)}</ul>
                </section>
              )}
              <section className="ns-shelf" aria-label="Everything">
                <h2>{audio.length ? 'All samples' : 'Everything'}</h2>
                <ul className="ns-tiles">{(audio.length ? audio : docs).slice(0, 24).map(n => <Tile key={n.id} node={n} active={selected?.id === n.id} />)}</ul>
              </section>
            </div>
          </>
        )}
      </main>

      <aside className="ns-now" aria-label="Now playing">
        {focus && (
          <>
            <p className="ns-now__label">{selected ? 'Selected' : 'Featured'}</p>
            <CoverArt node={focus} radius={8} className="ns-now__art" />
            <strong className="ns-now__title">{focus.title}</strong>
            <TagChips node={focus} />
          </>
        )}
        {!empty && <ConnectedClips detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen(v => !v)} />}
      </aside>

      <footer className="ns-player" aria-label="Player">
        <div className="ns-player__track">
          {nowNode ? <><CoverArt node={nowNode} radius={4} className="ns-player__art" /><span><strong>{nowNode.title}</strong><Chips node={nowNode} /></span></> : <span className="ns-player__idle">Nothing playing</span>}
        </div>
        <div className="ns-player__center">
          <div className="ns-player__controls">
            <button type="button" aria-label="Previous sample" disabled={!audio.length} onClick={() => skip(-1)}><TransportGlyph kind="prev" /></button>
            <button type="button" className="ns-player__main" aria-label={isPlaying ? 'Pause' : 'Play'} disabled={!audio.length} onClick={togglePlayback}><TransportGlyph kind={isPlaying ? 'pause' : 'play'} /></button>
            <button type="button" aria-label="Next sample" disabled={!audio.length} onClick={() => skip(1)}><TransportGlyph kind="next" /></button>
          </div>
          <div className="ns-player__wave">
            <span>{nowNode && clipFacts(nowNode).seconds !== null ? clock((clipFacts(nowNode).seconds ?? 0) * (playingId === nowNode.id ? progress : 0)) : '0:00'}</span>
            {nowNode?.fileType === 'audio' ? <Scrubber node={nowNode} color="#ffffff" /> : <span className="ns-player__line" />}
            <span>{nowNode ? clock(clipFacts(nowNode).seconds) : '--:--'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
