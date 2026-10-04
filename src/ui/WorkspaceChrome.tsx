import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { useUiStore } from '../store/uiStore';
import { useChatStore } from '../store/chatStore';
import { isFilterActive } from '../scene/emphasis';
import { hexFor } from '../scene/palette';
import { IconChat, IconData, IconGear, IconOctahedron } from './icons';
import MusicAnalysisStatusButton from './MusicAnalysisStatusButton';
import Toolbar from './Toolbar';
import FilterBar from './FilterBar';
import GraphNavigator from './GraphNavigator';
import CorpusSwitcher from './CorpusSwitcher';

/** The surrounding workspace owns layout; the graph keeps its existing renderer. */
export default function WorkspaceChrome() {
  const nodes = useGraphStore(s => s.nodes);
  const edges = useGraphStore(s => s.edges);
  const phase = useGraphStore(s => s.phase);
  const activeName = useCorpusStore(s => s.activeName);
  const filtersActive = useUiStore(s => isFilterActive(s.filter));
  const selectedId = useUiStore(s => s.selectedId);
  const clusterNames = useGraphStore(s => s.clusterNames);
  const localNames = useGraphStore(s => s.localClusterNames);
  const [toolsTarget, setToolsTarget] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<'graph' | 'files'>('graph');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryRef = useRef<HTMLElement>(null);
  const docs = useMemo(() => nodes.filter(n => n.kind === 'document'), [nodes]);
  const audioCount = docs.filter(n => n.fileType === 'audio').length;
  const music = audioCount > 0;
  const legend = useMemo(() => [...new Set(docs.map(n => n.cluster).filter(c => c >= 0))], [docs]);

  useEffect(() => {
    if (!libraryOpen) return;
    libraryRef.current?.querySelector<HTMLElement>('button')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A dialog or menu opened above the drawer owns Escape first.
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return;
      event.stopPropagation();
      setLibraryOpen(false);
      document.querySelector<HTMLElement>('.workspace-library-toggle')?.focus();
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [libraryOpen]);

  return <>
    <Toolbar graphToolsTarget={toolsTarget} libraryOpen={libraryOpen} onToggleLibrary={() => setLibraryOpen(v => !v)} />
    {libraryOpen && <button className="workspace-scrim" aria-label="Close library" onClick={() => setLibraryOpen(false)} />}
    <aside ref={libraryRef} id="workspace-library" onClick={event => { if ((event.target as HTMLElement).closest('[role="option"]')) setLibraryOpen(false); }} className={`workspace-library${libraryOpen ? ' is-open' : ''}`} aria-label="Library">
      <div className="workspace-library-scroll">
        <p className="workspace-eyebrow">Workspace</p>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          <button aria-current={tab === 'graph' ? 'page' : undefined} onClick={() => setTab('graph')}><IconOctahedron />Graph explorer</button>
          <button aria-current={tab === 'files' ? 'page' : undefined} onClick={() => setTab('files')}><IconData />All files <small>{docs.length}</small></button>
        </nav>
        <section className="workspace-collections" aria-label="Collections">
          <p className="workspace-eyebrow">Collection</p>
          <CorpusSwitcher variant="empty" />
        </section>
        {tab === 'files' ? <GraphNavigator embedded /> : (
          <details className="workspace-filters">
            <summary>Filter graph{filtersActive ? ' · On' : ''}</summary>
            <FilterBar embedded />
          </details>
        )}
      </div>
      <div className="workspace-library-footer">
        <button className="workspace-copilot-button" disabled={docs.length === 0} onClick={() => { setLibraryOpen(false); useChatStore.getState().setIsOpen(true); }}><IconChat /><span>{music ? 'Music copilot' : 'Ask your library'}<small>{music ? 'Find your next sound' : 'Explore your connections'}</small></span><span aria-hidden="true">↗</span></button>
        <MusicAnalysisStatusButton />
        <button className="workspace-settings" onClick={() => { setLibraryOpen(false); useUiStore.getState().setSettingsOpen(true); }}><IconGear />Settings</button>
      </div>
    </aside>
    {tab !== 'files' && <GraphNavigator />}
    <div className="workspace-stage-heading"><h1>{activeName}</h1><p>{docs.length} {audioCount === docs.length ? 'samples' : 'files'} · {phase === 'ready' ? music ? 'Connected by sound' : 'Connected by meaning' : 'Building your graph…'}</p></div>
    <div ref={setToolsTarget} className="workspace-tools-slot" />
    <div className="workspace-legend" aria-label="Graph legend">{legend.slice(0, 4).map(c => <span key={c} title={clusterNames[c] ?? localNames[c] ?? `Cluster ${c + 1}`}><i style={{ background: hexFor(c) }} />{clusterNames[c] ?? localNames[c] ?? `Cluster ${c + 1}`}</span>)}{legend.length > 4 && <span>+{legend.length - 4} more</span>}</div>
    {!selectedId && <aside className="workspace-inspector-empty" aria-label="Details"><p className="workspace-eyebrow">Details</p><div><IconOctahedron /><h2>Follow a connection.</h2><p>Select a node to explore {music ? 'its sound, musical features, and related samples.' : 'its contents and connections.'}</p><span>Click a node to get started</span></div></aside>}
    <footer id="workspace-transport" className="workspace-transport" aria-label="Playback and workspace status"><div className="workspace-status"><span className="workspace-status-dot" />{phase === 'ready' ? 'Your library is ready' : 'Processing files…'}<span>{docs.length} files · {edges.length} connections</span><span className="workspace-status-hint">Drag to explore · Scroll to zoom</span></div></footer>
  </>;
}
