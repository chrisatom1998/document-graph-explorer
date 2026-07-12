import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { searchCorpus, searchCorpusLexical, type SearchHit } from '../search/semanticSearch';

const MAX_SHOW_ME_RESULTS = 40;

export default function ShowMePanel() {
  const open = useUiStore((s) => s.showMeOpen);
  const setOpen = useUiStore((s) => s.setShowMeOpen);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const sendCamera = useUiStore((s) => s.sendCamera);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);

  const [topic, setTopic] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'empty'>('idle');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const runShowMe = (e: FormEvent) => {
    e.preventDefault();
    const q = topic.trim();
    if (!q) {
      setResults([]);
      setStatus('idle');
      setSearchResults(null);
      return;
    }

    const seq = ++requestSeq.current;
    setStatus('searching');
    const applyHits = (hits: SearchHit[]) => {
        if (seq !== requestSeq.current) return;
        const shown = hits.slice(0, MAX_SHOW_ME_RESULTS);
        setResults(shown);
        setStatus(shown.length > 0 ? 'done' : 'empty');
        setSearchResults(shown.map((hit) => hit.id), 'showMe');
        if (shown.length > 0) sendCamera('frameSet', shown.map((hit) => hit.id));
    };
    void (async () => {
      try {
        applyHits(await searchCorpusLexical(q));
        applyHits(await searchCorpus(q));
      } catch (err) {
        console.warn('show me failed', err);
        if (seq !== requestSeq.current) return;
        setStatus('empty');
      }
    })();
  };

  const close = () => {
    setOpen(false);
    setSearchResults(null);
  };

  return (
    <div className="show-me-layer">
      <section className="show-me-panel glass-panel" aria-label="Show me topic matches">
        <form className="show-me-panel__form" onSubmit={runShowMe}>
          <input
            ref={inputRef}
            className="show-me-panel__input"
            type="text"
            value={topic}
            placeholder="Show me a topic..."
            aria-label="Topic to show in the graph"
            onChange={(e) => setTopic(e.target.value)}
          />
          <button type="submit" className="show-me-panel__submit">
            Show me
          </button>
          <button
            type="button"
            className="icon-btn-close"
            title="Close"
            onClick={close}
          >
            x
          </button>
        </form>

        <div className="show-me-panel__body" aria-live="polite">
          {status === 'searching' && <p className="show-me-panel__note">Finding matches...</p>}
          {status === 'empty' && <p className="show-me-panel__note">No matching nodes found.</p>}
          {status === 'done' && (
            <>
              <p className="show-me-panel__count">
                {results.length} highlighted {results.length === 1 ? 'node' : 'nodes'}
              </p>
              <div className="show-me-panel__results">
                {results.slice(0, 8).map((hit) => {
                  const node = nodes[nodeIndex[hit.id]];
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      className="show-me-panel__result"
                      title={node?.title ?? hit.id}
                      onClick={() => useUiStore.getState().setSelected(hit.id)}
                    >
                      <span>{node?.title ?? hit.id}</span>
                      <span className={`match-kind-badge kind-${hit.matchKind}`}>
                        {hit.matchKind}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
