import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { DocNode } from '../../model/types';
import { IconGear, IconSearch } from '../../ui/icons';
import { GraphCard } from '../music/GraphSlot';
import FullDetails from '../music/FullDetails';
import { clipColor, shelvesFor } from '../music/library';
import { Chips, CoverArt, PlayButton, Scrubber, TagChips, TransportGlyph, partner, shade } from '../music/parts';
import { addFiles, addFolder, openSearch, openSettings, playClip, selectClip, skip, togglePlayback, usePlayerStore } from '../music/player';
import { useDemoLoader, useLibrary } from '../music/useLibrary';
import './foryou.css';

function Card({ node, active }: { node: DocNode; active: boolean }) {
  return (
    <li className={`fy-card${active ? ' is-active' : ''}`}>
      <button type="button" className="fy-card__open" aria-label={`Open ${node.title}`} onClick={() => selectClip(node.id)} />
      <span className="fy-card__art"><CoverArt node={node} radius={14} /><PlayButton node={node} className="fy-card__play" onPlay={() => selectClip(node.id)} /></span>
      <strong>{node.title}</strong>
      <Chips node={node} />
    </li>
  );
}

/** Option C — a "For You" home: featured mix, shelves of similar sounds and an expandable Sound Map. */
export default function ForYouShell() {
  const { docs, audio, selected, focus, neighbors, empty } = useLibrary();
  const demo = useDemoLoader();
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState(false);
  const playingId = usePlayerStore(s => s.currentId);
  const isPlaying = usePlayerStore(s => s.playing);
  const nowNode = docs.find(d => d.id === playingId) ?? focus;
  const shelves = useMemo(() => shelvesFor(focus, docs, neighbors), [focus, docs, neighbors]);
  const base = focus ? clipColor(focus) : '#ff6b4a';

  // Escape closes the expanded map (or the details drawer) before App's own Escape chain runs.
  useEffect(() => {
    if (!expanded && !details) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (details) setDetails(false);
      else setExpanded(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [expanded, details]);

  return (
    <div className="mx-shell fy-root">
      <header className="fy-top">
        <span className="fy-brand"><i aria-hidden="true" />Resonance</span>
        <nav className="fy-tabs" aria-label="Views">
          <button type="button" aria-current={!expanded ? 'page' : undefined} onClick={() => setExpanded(false)}>For You</button>
          <button type="button" aria-current={expanded ? 'page' : undefined} disabled={empty} onClick={() => setExpanded(true)}>Sound Map</button>
        </nav>
        <span className="fy-top__tools">
          <button type="button" className="fy-search" onClick={openSearch} disabled={empty}><IconSearch /><span>Search sounds</span></button>
          <button type="button" className="fy-icon" aria-label="Add sounds" title="Add sounds" onClick={addFiles}>+</button>
          <button type="button" className="fy-icon" aria-label="Settings" onClick={openSettings}><IconGear /></button>
        </span>
      </header>

      <main className="fy-main">
        {empty ? (
          <section className="fy-welcome" aria-label="Welcome">
            <h1>For You</h1>
            <p>Bring in some sounds and this page fills with mixes of the ones that belong together: same key, same tempo, same feel.</p>
            <div className="fy-welcome__grid">
              <button type="button" className="fy-start fy-start--hero" disabled={demo.busy !== null} onClick={() => demo.start('audio')}>
                <span className="fy-start__eyebrow">Start here</span>
                <strong>{demo.busy === 'audio' ? 'Loading sample pack…' : 'Sample pack mix'}</strong>
                <small>8 generated loops and one-shots, analysed on this device</small>
                <span className="fy-start__play" aria-hidden="true"><TransportGlyph kind="play" /></span>
              </button>
              <button type="button" className="fy-start fy-start--b" onClick={addFiles}><strong>Add your sounds</strong><small>Drop files anywhere</small></button>
              <button type="button" className="fy-start fy-start--c" onClick={addFolder}><strong>Add a folder</strong><small>Sample packs and crates</small></button>
              <button type="button" className="fy-start fy-start--d" disabled={demo.busy !== null} onClick={() => demo.start('docs')}><strong>{demo.busy === 'docs' ? 'Loading…' : 'Document demo'}</strong><small>100 PDFs and notes</small></button>
            </div>
          </section>
        ) : (
          <>
            <h1 className="fy-title">For You</h1>
            {focus && (
              <section className="fy-feature" aria-label={selected ? 'Selected sound' : 'Featured sound'} style={{ '--fy-a': shade(base, -0.1), '--fy-b': shade(partner(base), -0.45) } as CSSProperties}>
                <CoverArt node={focus} radius={18} className="fy-feature__art" />
                <div className="fy-feature__body">
                  <p className="fy-eyebrow">{selected ? 'Now selected' : 'Your featured sound'}</p>
                  <h2>{focus.title}</h2>
                  {focus.fileType === 'audio' && <Scrubber node={focus} color="#ffffff" className="fy-feature__wave" />}
                  <TagChips node={focus} heading="All tags" className="fy-feature__tags" />
                  <div className="fy-feature__actions">
                    {focus.fileType === 'audio' && (
                      <button type="button" className="fy-btn fy-btn--play" onClick={() => { if (!selected) selectClip(focus.id); playClip(focus.id); }}>
                        <TransportGlyph kind={isPlaying && playingId === focus.id ? 'pause' : 'play'} />{isPlaying && playingId === focus.id ? 'Pause' : 'Play'}
                      </button>
                    )}
                    <button type="button" className="fy-btn" disabled={!selected} onClick={() => setDetails(true)}>{selected ? 'Full details' : 'Pick a sound for details'}</button>
                    <button type="button" className="fy-btn" onClick={() => { selectClip(focus.id); setExpanded(true); }}>Show on map</button>
                  </div>
                </div>
              </section>
            )}

            <GraphCard
              title="Sound Map"
              subtitle="Every sound, placed by how alike they are"
              className={`fy-map${expanded ? ' is-expanded' : ''}`}
              actions={<button type="button" className="fy-expand" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Close map' : 'Expand'}</button>}
            />

            {shelves.map(shelf => (
              <section key={shelf.id} className="fy-shelf" aria-label={shelf.title}>
                <header><h2>{shelf.title}</h2>{shelf.subtitle && <small>{shelf.subtitle}</small>}</header>
                <ul className="fy-row">{shelf.items.slice(0, 20).map(n => <Card key={n.id} node={n} active={selected?.id === n.id} />)}</ul>
              </section>
            ))}
          </>
        )}
      </main>

      {details && selected && (
        <aside className="fy-drawer" aria-label="Full details">
          <header><strong>{selected.title}</strong><button type="button" className="fy-icon" aria-label="Close details" onClick={() => setDetails(false)}>×</button></header>
          <TagChips node={selected} heading="All tags" />
          <FullDetails onClose={() => setDetails(false)} />
        </aside>
      )}

      {nowNode && (
        <footer className="fy-mini" aria-label="Player">
          <CoverArt node={nowNode} radius={10} className="fy-mini__art" />
          <span className="fy-mini__text"><strong>{nowNode.title}</strong><Chips node={nowNode} /></span>
          {nowNode.fileType === 'audio' && <Scrubber node={nowNode} color="#ffffff" className="fy-mini__wave" />}
          <span className="fy-mini__controls">
            <button type="button" aria-label="Previous sample" disabled={!audio.length} onClick={() => skip(-1)}><TransportGlyph kind="prev" /></button>
            <button type="button" className="fy-mini__main" aria-label={isPlaying ? 'Pause' : 'Play'} disabled={!audio.length} onClick={togglePlayback}><TransportGlyph kind={isPlaying ? 'pause' : 'play'} /></button>
            <button type="button" aria-label="Next sample" disabled={!audio.length} onClick={() => skip(1)}><TransportGlyph kind="next" /></button>
          </span>
        </footer>
      )}
    </div>
  );
}
