import { useEffect, useMemo, useState } from 'react';
import { clipTags, featuredClip, forYouShelves } from '../../audio/audioHome';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import SampleClipPlayer from '../SampleClipPlayer';

/** Audio-library home: the selected sound stays in front, similar sounds are a fingerprint shelf, and the graph is a map you open. */
export default function ForYouHome({ onOpenMap }: { onOpenMap: () => void }) {
  const nodes = useGraphStore(state => state.nodes);
  const edges = useGraphStore(state => state.edges);
  const selectedId = useUiStore(state => state.selectedId);
  const setSelected = useUiStore(state => state.setSelected);
  const focus = featuredClip(nodes, selectedId);
  const shelves = useMemo(() => forYouShelves(focus, nodes, edges), [focus, nodes, edges]);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setPlaying(false); }, [focus?.id]);
  if (!focus) return null;
  const tags = clipTags(focus);
  return (
    <div className="rs-foryou__body">
      <h1>For you</h1>
      <section className="rs-foryou__feature" aria-label={selectedId === focus.id ? 'Selected sound' : 'Featured sound'}>
        <p className="rs-foryou__eyebrow">{selectedId === focus.id ? 'Now selected' : 'Featured sound'}</p>
        <h2>{focus.title}</h2>
        {tags.length > 0 && (
          <ul className="rs-foryou__tags" aria-label="Tags">
            {tags.map(tag => <li key={`${tag.group}:${tag.label}`}><span>{tag.group}</span>{tag.label}</li>)}
          </ul>
        )}
        <div className="rs-foryou__actions">
          <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? 'Close player' : 'Play'}</button>
          <button type="button" onClick={onOpenMap}>Open sound map</button>
        </div>
        {playing && <SampleClipPlayer node={focus} />}
      </section>
      {shelves.map(shelf => (
        <section key={shelf.id} className="rs-foryou__shelf" aria-label={shelf.title}>
          <header>
            <h2>{shelf.title}</h2>
            {shelf.subtitle && <p>{shelf.subtitle}</p>}
          </header>
          <ul>
            {shelf.items.map(item => (
              <li key={item.id}>
                <button type="button" aria-pressed={item.id === selectedId} onClick={() => setSelected(item.id)}>{item.title}</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!focus.audio?.embedding && <p className="rs-foryou__note">Similar sounds show up once each clip has a sound fingerprint.</p>}
    </div>
  );
}
