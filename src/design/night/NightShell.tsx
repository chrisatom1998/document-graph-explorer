import { useState } from 'react';
import type { DocNode } from '../../model/types';
import { IconGear, IconSearch } from '../../ui/icons';
import { GraphCard } from '../music/GraphSlot';
import FullDetails from '../music/FullDetails';
import { clipColor, clipFacts, clock } from '../music/library';
import { Chips, CoverArt, PlayButton, Scrubber, TagChips, TransportGlyph, shade } from '../music/parts';
import { addFiles, addFolder, openSearch, openSettings, playClip, selectClip, skip, togglePlayback, usePlayerStore } from '../music/player';
import { useDemoLoader, useLibrary } from '../music/useLibrary';
import './night.css';

type Shelf = 'all' | 'loops' | 'shots' | 'keyed';
const SHELVES: Array<{ id: Shelf; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'loops', label: 'Loops' }, { id: 'shots', label: 'One-shots' }, { id: 'keyed', label: 'In key' },
];

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
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

/** Option A — a Spotify-like dark player: library rail, playlist header, tiles and a persistent now-playing bar. */
export default function NightShell() {
  const { docs, audio, selected, focus, neighbors, empty } = useLibrary();
  const demo = useDemoLoader();
  const [shelf, setShelf] = useState<Shelf>('all');
  const [details, setDetails] = useState(false);
  const playingId = usePlayerStore(s => s.currentId);
  const isPlaying = usePlayerStore(s => s.playing);
  const progress = usePlayerStore(s => s.progress);
  const nowNode = docs.find(d => d.id === playingId) ?? focus;
  const color = focus ? clipColor(focus) : '#1ed760';
  const listed = docs.filter(d => {
    const f = clipFacts(d);
    return shelf === 'all' || (shelf === 'loops' && f.shape === 'Loop') || (shelf === 'shots' && f.shape === 'One-shot') || (shelf === 'keyed' && !!f.key);
  });
  const facts = focus ? clipFacts(focus) : null;

  return (
    <div className="mx-shell ns-root">
      <nav className="ns-nav" aria-label="Main">
        <span className="ns-brand"><svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" /><path d="M6 10v4M9.5 7v10M13 9v6M16.5 6v12" /></svg>Resonance</span>
        <button type="button" className="ns-nav__item is-current" aria-current="page"><svg className="mx-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" /></svg>Home</button>
        <button type="button" className="ns-nav__item" onClick={openSearch} disabled={empty}><IconSearch />Search</button>
        <button type="button" className="ns-nav__item" onClick={openSettings}><IconGear />Settings</button>
      </nav>

      <aside className="ns-library" aria-label="Your library">
        <header className="ns-library__head">
          <h2>Your Library</h2>
          <button type="button" className="ns-round" aria-label="Add sounds" title="Add sounds" onClick={addFiles}>+</button>
        </header>
        <div className="ns-pills" role="group" aria-label="Show">
          {SHELVES.map(s => <button key={s.id} type="button" aria-pressed={shelf === s.id} onClick={() => setShelf(s.id)}>{s.label}</button>)}
        </div>
        {docs.length === 0
          ? <div className="ns-library__empty"><strong>Build your first crate</strong><p>Drop samples, loops or a whole folder anywhere on this window.</p><button type="button" className="ns-pill-btn" onClick={addFolder}>Add a folder</button></div>
          : (
            <ul className="ns-rows">
              {listed.map(node => {
                const f = clipFacts(node);
                return (
                  <li key={node.id}>
                    <button type="button" className={`ns-row${selected?.id === node.id ? ' is-active' : ''}`} onClick={() => selectClip(node.id)}>
                      <CoverArt node={node} radius={4} className="ns-row__art" />
                      <span className="ns-row__text">
                        <strong className={playingId === node.id ? 'is-playing' : ''}>{node.title}</strong>
                        <small>{[f.kind, f.bpm !== null ? `${f.bpm} BPM` : null, f.key].filter(Boolean).join(' · ')}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
      </aside>

      <main className="ns-main" style={{ '--ns-hero': shade(color, -0.25) } as React.CSSProperties}>
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
              <button type="button" className="ns-start" disabled={demo.busy !== null} onClick={() => demo.start('docs')}>
                <span className="ns-start__art ns-start__art--d" aria-hidden="true" />
                <strong>{demo.busy === 'docs' ? 'Loading documents…' : 'Document demo'}</strong><small>100 sample PDFs and notes</small>
              </button>
            </div>
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
            {focus && (
              <div className="ns-actions">
                {focus.fileType === 'audio' && (
                  <button type="button" className="ns-bigplay" aria-label={isPlaying && playingId === focus.id ? `Pause ${focus.title}` : `Play ${focus.title}`} onClick={() => { if (!selected) selectClip(focus.id); playClip(focus.id); }}>
                    <TransportGlyph kind={isPlaying && playingId === focus.id ? 'pause' : 'play'} />
                  </button>
                )}
                <button type="button" className="ns-pill-btn" aria-expanded={details} disabled={!selected} title={selected ? undefined : 'Pick a sound first'} onClick={() => setDetails(v => !v)}>{details ? 'Hide details' : 'Full details'}</button>
                <button type="button" className="ns-pill-btn" onClick={() => selectClip(focus.id)}>Find in map</button>
              </div>
            )}
            {focus && <TagChips node={focus} className="ns-tags-inline" />}
            <div className="ns-body">
              <GraphCard title="Sound Map" subtitle="Closer means more alike. Click a dot to open it." className="ns-map" />
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
        {focus ? (
          <>
            <p className="ns-now__label">{selected ? 'Selected' : 'Featured'}</p>
            <CoverArt node={focus} radius={8} className="ns-now__art" />
            <strong className="ns-now__title">{focus.title}</strong>
            <TagChips node={focus} />
            {neighbors.length > 0 && (
              <section className="ns-why" aria-label="Why they're connected">
                <h3>Why they’re connected</h3>
                <ul>
                  {neighbors.slice(0, 5).map(n => (
                    <li key={n.node.id}>
                      <button type="button" onClick={() => selectClip(n.node.id)}>
                        <CoverArt node={n.node} radius={4} className="ns-why__art" />
                        <span><strong>{n.node.title}</strong><small>{n.reasons.join(' · ')}</small></span>
                        <i style={{ '--w': `${Math.round(n.strength * 100)}%` } as React.CSSProperties} aria-label={`${Math.round(n.strength * 100)}% match`} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {details && selected && <FullDetails onClose={() => setDetails(false)} />}
          </>
        ) : <p className="ns-now__empty">Pick a sound to see what it connects to.</p>}
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
        <div className="ns-player__side">
          <button type="button" className="ns-player__icon" onClick={openSearch} disabled={empty} aria-label="Search"><IconSearch /></button>
        </div>
      </footer>

      <nav className="ns-tabbar" aria-label="Sections">
        <button type="button" aria-current="page"><svg className="mx-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z" /></svg>Home</button>
        <button type="button" onClick={openSearch} disabled={empty}><IconSearch />Search</button>
        <button type="button" onClick={addFiles}><svg className="mx-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h3v16H5zM10 4h3v16h-3zM15.5 4.5l3-.8 3.9 15.3-3 .8z" /></svg>Add</button>
        <button type="button" onClick={openSettings}><IconGear />Settings</button>
      </nav>
    </div>
  );
}
