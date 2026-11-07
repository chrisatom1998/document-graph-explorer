import { useState, type CSSProperties } from 'react';
import type { DocNode } from '../../model/types';
import { IconGear, IconSearch } from '../../ui/icons';
import { GraphCard } from '../music/GraphSlot';
import FullDetails from '../music/FullDetails';
import { clipColor, clipFacts, clock } from '../music/library';
import { Chips, CoverArt, PlayButton, Scrubber, TagChips, TransportGlyph, partner } from '../music/parts';
import { addFiles, addFolder, openSearch, openSettings, playClip, selectClip, skip, togglePlayback, usePlayerStore } from '../music/player';
import { useDemoLoader, useLibrary } from '../music/useLibrary';
import './aura.css';

type Section = 'recent' | 'loops' | 'shots';

function Transport({ size }: { size: 'sm' | 'lg' }) {
  const playing = usePlayerStore(s => s.playing);
  return (
    <div className={`au-transport au-transport--${size}`}>
      <button type="button" aria-label="Previous sample" onClick={() => skip(-1)}><TransportGlyph kind="prev" /></button>
      <button type="button" className="au-transport__main" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlayback}><TransportGlyph kind={playing ? 'pause' : 'play'} /></button>
      <button type="button" aria-label="Next sample" onClick={() => skip(1)}><TransportGlyph kind="next" /></button>
    </div>
  );
}

function subtitle(node: DocNode): string {
  const f = clipFacts(node);
  return [f.shape ?? f.kind, f.bpm !== null ? `${f.bpm} BPM` : null, f.key].filter(Boolean).join(' · ');
}

/** Option B — an Apple Music-like player: colour wash from the selected sample, frosted panels, a now-playing pill. */
export default function AuraShell() {
  const { docs, audio, selected, focus, neighbors, empty } = useLibrary();
  const demo = useDemoLoader();
  const [section, setSection] = useState<Section>('recent');
  const [details, setDetails] = useState(false);
  const playingId = usePlayerStore(s => s.currentId);
  const progress = usePlayerStore(s => s.progress);
  const nowNode = docs.find(d => d.id === playingId) ?? focus;
  const base = focus ? clipColor(focus) : '#fa2d48';
  const wash = { '--au-1': base, '--au-2': partner(base) } as CSSProperties;
  const listed = docs.filter(d => {
    const f = clipFacts(d);
    return section === 'recent' || (section === 'loops' && f.shape === 'Loop') || (section === 'shots' && f.shape === 'One-shot');
  });

  return (
    <div className="mx-shell au-root" style={wash}>
      <div className="au-wash" aria-hidden="true"><i /><i /><i /></div>

      <aside className="au-side" aria-label="Library">
        <span className="au-brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>Resonance</span>
        <button type="button" className="au-search" onClick={openSearch} disabled={empty}><IconSearch />Search</button>
        <p className="au-side__label">Library</p>
        <div className="au-side__nav" role="group" aria-label="Show">
          {([['recent', 'Recently Added'], ['loops', 'Loops'], ['shots', 'One-shots']] as Array<[Section, string]>).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>
          ))}
        </div>
        <p className="au-side__label">Samples</p>
        <ul className="au-list">
          {listed.map(node => (
            <li key={node.id}>
              <button type="button" className={`au-list__row${selected?.id === node.id ? ' is-active' : ''}`} onClick={() => selectClip(node.id)}>
                <CoverArt node={node} radius={6} className="au-list__art" />
                <span><strong>{node.title}</strong><small>{subtitle(node)}</small></span>
              </button>
            </li>
          ))}
          {!docs.length && <li className="au-list__empty">Your samples appear here.</li>}
        </ul>
        <div className="au-side__foot">
          <button type="button" onClick={addFiles}>Add sounds</button>
          <button type="button" aria-label="Settings" onClick={openSettings}><IconGear /></button>
        </div>
      </aside>

      <header className="au-top">
        <Transport size="sm" />
        <div className="au-lcd" aria-label="Now playing">
          {nowNode ? (
            <>
              <CoverArt node={nowNode} radius={4} className="au-lcd__art" />
              <span className="au-lcd__text"><strong>{nowNode.title}</strong><small>{subtitle(nowNode)}</small></span>
              <span className="au-lcd__bar" aria-hidden="true"><i style={{ width: `${playingId === nowNode.id ? Math.round(progress * 100) : 0}%` }} /></span>
            </>
          ) : <span className="au-lcd__idle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg></span>}
        </div>
        <span className="au-top__spacer" />
      </header>

      {empty ? (
        <main className="au-welcome" aria-label="Welcome">
          <div className="au-glass au-welcome__card">
            <p className="au-kicker">Resonance</p>
            <h1>Hear how your sounds connect.</h1>
            <p>Key, tempo and sound tags are worked out on this device. Nothing leaves it.</p>
            <div className="au-welcome__actions">
              <button type="button" className="au-btn au-btn--primary" disabled={demo.busy !== null} onClick={() => demo.start('audio')}>{demo.busy === 'audio' ? 'Loading sample pack…' : 'Play the sample pack'}</button>
              <button type="button" className="au-btn" onClick={addFiles}>Add your sounds</button>
              <button type="button" className="au-btn" onClick={addFolder}>Add a folder</button>
            </div>
            <button type="button" className="au-link" disabled={demo.busy !== null} onClick={() => demo.start('docs')}>{demo.busy === 'docs' ? 'Loading documents…' : 'Or try the 100-document demo'}</button>
          </div>
        </main>
      ) : (
        <main className="au-main">
          <GraphCard title="Sound Map" subtitle={`${docs.length} ${audio.length ? 'samples' : 'files'} · closer means more alike`} className="au-glass au-map" />
        </main>
      )}

      {!empty && focus && (
        <aside className="au-glass au-detail" aria-label="Sample details">
          <CoverArt node={focus} radius={12} className="au-detail__art" />
          <div className="au-detail__titles">
            <h2>{focus.title}</h2>
            <p>{selected ? subtitle(focus) : `Featured · ${subtitle(focus)}`}</p>
          </div>
          {focus.fileType === 'audio' && (
            <div className="au-detail__wave">
              <Scrubber node={focus} color="#ffffff" />
              <span><small>{clock((clipFacts(focus).seconds ?? 0) * (playingId === focus.id ? progress : 0))}</small><small>{clock(clipFacts(focus).seconds)}</small></span>
            </div>
          )}
          {focus.fileType === 'audio' && (
            <div className="au-detail__transport">
              <button type="button" aria-label="Previous sample" onClick={() => skip(-1)}><TransportGlyph kind="prev" /></button>
              <PlayButton node={focus} className="au-detail__play" onPlay={() => { if (!selected) selectClip(focus.id); }} />
              <button type="button" aria-label="Next sample" onClick={() => skip(1)}><TransportGlyph kind="next" /></button>
            </div>
          )}
          <TagChips node={focus} />
          {neighbors.length > 0 && (
            <section className="au-next" aria-label="Similar sounds">
              <h3>Up Next · Sounds like this</h3>
              <ul>
                {neighbors.slice(0, 6).map(n => (
                  <li key={n.node.id}>
                    <button type="button" className="au-next__row" onClick={() => selectClip(n.node.id)}>
                      <CoverArt node={n.node} radius={6} className="au-next__art" />
                      <span><strong>{n.node.title}</strong><small>{n.reasons.join(' · ')}</small></span>
                      <Chips node={n.node} />
                    </button>
                    <PlayButton node={n.node} className="au-next__play" onPlay={() => selectClip(n.node.id)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <button type="button" className="au-btn au-btn--wide" aria-expanded={details} disabled={!selected} onClick={() => setDetails(v => !v)}>{details ? 'Hide full details' : selected ? 'Full details' : 'Pick a sample for full details'}</button>
          {details && selected && <FullDetails onClose={() => setDetails(false)} />}
        </aside>
      )}

      <nav className="au-tabbar" aria-label="Sections">
        <button type="button" aria-current="page" onClick={() => { if (focus) playClip(focus.id); }} disabled={!audio.length}><TransportGlyph kind="play" />Listen</button>
        <button type="button" onClick={openSearch} disabled={empty}><IconSearch />Search</button>
        <button type="button" onClick={addFiles}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Add</button>
        <button type="button" onClick={openSettings}><IconGear />Settings</button>
      </nav>
    </div>
  );
}
