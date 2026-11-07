import { useMemo } from 'react';
import type { DocNode, Edge } from '../../model/types';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { usePlayerStore } from '../../store/playerStore';
import { useViewStore } from '../../store/viewStore';
import { hexFor } from '../../scene/palette';
import { openFilePicker } from '../../ingest/DropZone';
import { openFolderPicker } from '../../ingest/folderPicker';
import { DimsToggleButton } from '../DimsToggleButton';
import { useDemoLoader } from '../useDemoLoader';
import { buildForYou, gradientFor, keyOf, tagBasisText, tagText, tempoOf, type Crate } from './forYouModel';

/** Constellation slots (viewBox 420x220); the first slot is the centred, ringed focus clip. */
const SLOTS: [number, number][] = [[238, 112], [60, 138], [118, 62], [330, 54], [388, 118], [322, 178], [150, 176]];

function PlayGlyph() { return <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" /></svg>; }

/** A small map of real clips: one per neighbourhood (strongest first) drawn at fixed slots, joined only by links that exist. */
function SoundMapArt({ nodes, edges, focus }: { nodes: DocNode[]; edges: Edge[]; focus: DocNode | null }) {
  const picked = useMemo(() => {
    const chosen: DocNode[] = focus ? [focus] : [];
    const seen = new Set(focus && focus.cluster >= 0 ? [focus.cluster] : []);
    for (const n of [...nodes].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))) {
      if (chosen.length >= SLOTS.length) break;
      if (chosen.includes(n) || (n.cluster >= 0 && seen.has(n.cluster))) continue;
      seen.add(n.cluster);
      chosen.push(n);
    }
    for (const n of nodes) if (chosen.length < SLOTS.length && !chosen.includes(n)) chosen.push(n);
    return chosen;
  }, [nodes, focus]);
  const at = new Map(picked.map((n, i) => [n.id, SLOTS[i]]));
  const links = edges.filter(e => at.has(e.source) && at.has(e.target));
  const ghost = picked.length === 0;
  return (
    <svg className="fy-art" viewBox="0 0 420 220" aria-hidden="true" focusable="false">
      {ghost
        ? SLOTS.slice(0, 5).map((p, i, all) => i > 0 && <line key={i} className="fy-art__ghost-link" x1={all[i - 1][0]} y1={all[i - 1][1]} x2={p[0]} y2={p[1]} />)
        : links.map(e => { const a = at.get(e.source)!, b = at.get(e.target)!; return <line key={e.id} className="fy-art__link" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />; })}
      {ghost
        ? SLOTS.slice(0, 5).map((p, i) => <circle key={i} className="fy-art__ghost" cx={p[0]} cy={p[1]} r={i === 0 ? 11 : 7} />)
        : picked.map((n, i) => {
          const [x, y] = SLOTS[i];
          const fill = n.cluster >= 0 ? hexFor(n.cluster) : gradientFor(n)[0];
          return (
            <g key={n.id}>
              {i === 0 && <circle className="fy-art__halo" cx={x} cy={y} r="27" />}
              <circle cx={x} cy={y} r={i === 0 ? 11 : 7} fill={fill} />
            </g>
          );
        })}
    </svg>
  );
}

function CrateSwatch({ node, queue }: { node: DocNode; queue: string[] }) {
  const [a, b] = gradientFor(node);
  return (
    <button type="button" className="fy-swatch" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} aria-label={`Play ${node.title}`} onClick={() => usePlayerStore.getState().play(node.id, queue)} />
  );
}

function MixPanel({ crate, soundCount }: { crate: Crate | null; soundCount: number }) {
  const queue = crate?.clips.map(c => c.id) ?? [];
  const range = crate && crate.bpmMin !== null && crate.bpmMax !== null
    ? (crate.bpmMin === crate.bpmMax ? `${crate.bpmMin} BPM` : `${crate.bpmMin}–${crate.bpmMax} BPM`)
    : null;
  let title = 'No key crate yet';
  let body = 'Add sounds and Resonance will group the ones that share a key.';
  if (crate) {
    title = `${crate.key} crate`;
    body = `${crate.clips.length} ${crate.clips.length === 1 ? 'clip' : 'clips'}${range ? `, ${range}` : ''}, all in ${crate.key}.`;
  } else if (soundCount > 0) {
    title = 'No keys found yet';
    body = `None of your ${soundCount} ${soundCount === 1 ? 'clip has' : 'clips have'} a detected key. Keys come from music analysis, which runs on this device when the audio models are installed (Settings), or from a key in the file name.`;
  }
  return (
    <section className="fy-mix" aria-labelledby="fy-mix-title">
      <h2 className="fy-kicker" id="fy-mix-title">Mixes in key</h2>
      <p className="fy-mix__title">{title}</p>
      <p className="fy-mix__body">{body}</p>
      <div className="fy-swatches" role="group" aria-label="Clips in this crate">
        {crate
          ? crate.clips.slice(0, 4).map(n => <CrateSwatch key={n.id} node={n} queue={queue} />)
          : [0, 1, 2, 3].map(i => <span key={i} className="fy-swatch fy-swatch--empty" aria-hidden="true" />)}
      </div>
      <button type="button" className="fy-mix__play" disabled={!crate} aria-label={crate ? `Play the ${crate.key} crate` : 'Play crate (no crate yet)'} onClick={() => crate && usePlayerStore.getState().play(crate.clips[0].id, queue)}>
        <PlayGlyph />
      </button>
    </section>
  );
}

function SoundCard({ node, queue, active }: { node: DocNode; queue: string[]; active: boolean }) {
  const [a, b] = gradientFor(node);
  const bpm = tempoOf(node);
  const key = keyOf(node);
  const audio = node.fileType === 'audio';
  const open = () => { useUiStore.getState().setSelected(node.id); useViewStore.getState().setTab('graph'); };
  return (
    <li className={`fy-card${active ? ' is-playing' : ''}`}>
      <div className="fy-card__art" style={{ background: `linear-gradient(140deg, ${a}, ${b})` }}>
        {!audio && <span className="fy-card__type" aria-hidden="true">{node.fileType.toUpperCase().slice(0, 4)}</span>}
        {audio && <button type="button" className="fy-card__play" aria-label={`Play ${node.title}`} onClick={() => usePlayerStore.getState().play(node.id, queue)}><PlayGlyph /></button>}
      </div>
      <button type="button" className="fy-card__title" title={node.title} onClick={open}>{node.title}</button>
      <div className="fy-chips">
        {bpm !== null && <span className="fy-chip">{bpm} BPM</span>}
        {key && <span className="fy-chip">{key}</span>}
        {bpm === null && !key && <span className="fy-chip fy-chip--muted">{audio ? 'No tempo or key yet' : `${node.wordCount.toLocaleString()} words`}</span>}
      </div>
    </li>
  );
}

/** The For you view: a real summary of the library, never placeholder numbers. */
export default function ForYou() {
  const nodes = useGraphStore(s => s.nodes);
  const edges = useGraphStore(s => s.edges);
  const phase = useGraphStore(s => s.phase);
  const selectedId = useUiStore(s => s.selectedId);
  const currentId = usePlayerStore(s => s.currentId);
  const demo = useDemoLoader();
  const model = useMemo(() => buildForYou(nodes, edges, selectedId, currentId), [nodes, edges, selectedId, currentId]);
  const { sounds, documents, neighbourhoods, focus, related, tags, crate } = model;
  const total = sounds.length || documents;
  const noun = sounds.length ? (sounds.length === 1 ? 'clip' : 'clips') : (documents === 1 ? 'document' : 'documents');
  const empty = nodes.length === 0;
  const busy = empty && phase !== 'idle';
  const mapNodes = sounds.length ? sounds : nodes.filter(n => n.kind === 'document');

  const heading = empty
    ? 'Your sound map starts here'
    : `${total} ${noun}${neighbourhoods !== null ? `, ${neighbourhoods} ${neighbourhoods === 1 ? 'neighbourhood' : 'neighbourhoods'}` : ''}`;
  const lede = empty
    ? 'Add a folder or a few clips. Tempo, key and sound are analysed on this device, and nothing is uploaded.'
    : neighbourhoods === null
      ? 'Neighbourhoods appear once Resonance has finished linking your files.'
      : sounds.length
        ? 'See what sounds alike, shares a key, and mixes in tempo.'
        : 'This library has documents but no sounds. Add audio to see what sounds alike.';

  const cardQueue = [...(focus ? [focus.id] : []), ...related.map(n => n.id)];
  const rowTitle = focus && sounds.length ? (model.focusLinked ? `Sounds like ${focus.title}` : 'In your library') : 'Sounds like this';

  return (
    <section className="fy" aria-label="For you">
      <div className="fy-top">
        <section className="fy-map" aria-labelledby="fy-map-title">
          <div className="fy-map__copy">
            <h2 className="fy-kicker" id="fy-map-kicker">Sound map</h2>
            <h1 className="fy-map__title" id="fy-map-title">{heading}</h1>
            <p className="fy-map__lede">{lede}</p>
          </div>
          <SoundMapArt nodes={mapNodes} edges={edges} focus={focus} />
          <div className="fy-map__actions">
            {empty
              ? <button type="button" className="fy-btn fy-btn--white" onClick={openFilePicker}>Add files</button>
              : <button type="button" className="fy-btn fy-btn--white" onClick={() => useViewStore.getState().setTab('graph')}>Open sound map</button>}
            <DimsToggleButton />
          </div>
        </section>
        <MixPanel crate={crate} soundCount={sounds.length} />
      </div>

      <div className="fy-row-head">
        <h2 className="fy-row-title">{empty ? 'Sounds like what you add' : rowTitle}</h2>
        {!empty && <button type="button" className="fy-link" onClick={() => useViewStore.getState().setTab('library')}>Show all</button>}
      </div>
      <div className="fy-tags"><span className="fy-tags__label" id="fy-tags-label">Tags</span>
        {tags.length > 0
          ? <ul aria-labelledby="fy-tags-label">{tags.map(t => <li key={t.label} className={`fy-tag fy-tag--${t.basis}`} title={tagBasisText(t.basis)}>{tagText(t)}</li>)}</ul>
          : <span className="fy-tags__hint">None yet. Tags appear for analysed sounds, with how each was found.</span>}
      </div>
      {empty ? (
        <>
          <ul className="fy-cards fy-cards--empty" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(i => <li key={i} className="fy-card"><div className="fy-card__art" /><span className="fy-skel" /><span className="fy-skel fy-skel--short" /></li>)}</ul>
          <div className="fy-empty" role="status">
            <p>{busy ? 'Reading your files…' : 'No sounds yet. Sounds you add show up here with their tempo and key when they have been analysed. Tags appear once sounds have been analysed or named, and each says how it was found.'}</p>
            <div className="fy-empty__actions">
              <button type="button" className="fy-btn fy-btn--lime" onClick={openFolderPicker}>Add a folder</button>
              <button type="button" className="fy-btn fy-btn--ghost" onClick={openFilePicker}>Add files</button>
              <button type="button" className="fy-btn fy-btn--ghost" aria-busy={demo.loading === 'audio'} disabled={demo.loading !== null} onClick={() => demo.load('audio')}>{demo.loading === 'audio' ? 'Loading audio demo…' : 'Load audio demo'}</button>
              <button type="button" className="fy-btn fy-btn--ghost" aria-busy={demo.loading === 'docs'} disabled={demo.loading !== null} onClick={() => demo.load('docs')}>{demo.loading === 'docs' ? 'Loading demo…' : 'Load demo corpus'}</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <ul className="fy-cards">{(focus ? [focus, ...related] : related).slice(0, 6).map(n => <SoundCard key={n.id} node={n} queue={cardQueue} active={n.id === currentId} />)}</ul>
          {sounds.length > 0 && model.tempoClips === 0 && model.keyedClips === 0 && (
            <p className="fy-note">No tempo or key has been detected for these clips yet, so none is shown. Analysis runs on this device when the audio models are installed (Settings), or a BPM or key in the file name is used.</p>
          )}
        </>
      )}
    </section>
  );
}
