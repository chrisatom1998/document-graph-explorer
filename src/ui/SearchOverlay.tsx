import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { nodesMatchingFilter } from '../scene/emphasis';
import { searchCorpus, searchCorpusLexical } from '../search/semanticSearch';
import type { RetrievalMatchKind } from '../search/retrieval';
import { focusNode } from './focusNode';
import { showSimilarTo } from './showSimilar';
import { useActiveOptionScroll } from './useActiveOptionScroll';
import CloseButton from './CloseButton';

const DEBOUNCE_MS = 250;

interface ResultRow {
  id: string;
  score: number;
  matchKind: RetrievalMatchKind;
  snippet?: string;
  passageIndex?: number;
}

export default function SearchOverlay() {
  const searchOpen = useUiStore((s) => s.searchOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setSearchResults = useUiStore((s) => s.setSearchResults);
  const sendCamera = useUiStore((s) => s.sendCamera);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const filter = useUiStore((s) => s.filter);
  const allowed = useMemo(() => nodesMatchingFilter(nodes, edges, filter), [nodes, edges, filter]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [searching, setSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const showAllButtonRef = useRef<HTMLButtonElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  // Reset local state each time the overlay opens; autofocus the input.
  useEffect(() => {
    if (!searchOpen) return;
    setQuery('');
    setResults([]);
    setActiveIndex(0);
    setSearched(false);
    setFailed(false);
    setSearching(false);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [searchOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Invalidate immediately on every query/open-state change. Waiting until
    // the next debounce fires leaves a window where the previous response can
    // repaint highlights for a query the user already cleared or closed.
    const seq = ++requestSeq.current;
    if (!searchOpen) return;

    if (query.trim().length === 0) {
      setResults([]);
      setSearched(false);
      setFailed(false);
      setSearching(false);
      setSearchResults(null);
      return;
    }

    // Feedback starts with the keystroke, not the debounce: semantic search
    // can take a moment (the model may still be warming up), and an unchanged
    // list with no status reads as "search is broken".
    setSearching(true);

    debounceRef.current = setTimeout(() => {
      let landedResults = false;
      const applyResults = (res: ResultRow[]) => {
          if (seq !== requestSeq.current) return; // stale response
          landedResults = res.length > 0;
          setResults(res);
          setActiveIndex(0);
          setSearched(true);
          setFailed(false);
          setSearchResults(res.map((r) => r.id), 'search');
      };
      void (async () => {
        try {
          applyResults(await searchCorpusLexical(query, allowed ?? undefined));
          applyResults(await searchCorpus(query, allowed ?? undefined));
          if (seq === requestSeq.current) setSearching(false);
        } catch (err) {
          console.warn('search failed', err);
          if (seq !== requestSeq.current) return;
          setSearching(false);
          setSearched(true);
          // Only report a failure when no pass landed results — the lexical
          // pass may have already applied hits before the semantic one broke.
          setFailed(!landedResults);
          if (!landedResults) {
            // Drop any hits left over from a previous query so the failure
            // notice is visible instead of stale results.
            setResults([]);
            setActiveIndex(0);
            setSearchResults(null);
          }
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Closing (or a newer keystroke) must drop in-flight lexical/semantic
      // passes — otherwise a late applyResults can overwrite a showMe highlight.
      requestSeq.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen, allowed]);

  const browsing = query.trim().length === 0;
  const displayedResults: ResultRow[] = (browsing
    ? nodes
        .filter((node) => node.kind === 'document')
        .map((node) => ({ id: node.id, score: 0, matchKind: 'title' as const }))
    : results
  ).filter((row) => !allowed || allowed.has(row.id));
  const hasDisplayedResults = displayedResults.length > 0;
  const activeOptionId = hasDisplayedResults ? `search-option-${activeIndex}` : undefined;
  // Must run before the closed-overlay early return: hooks cannot be
  // conditional, and this list is only rendered while the overlay is open.
  useActiveOptionScroll(searchOpen ? activeOptionId : undefined);

  if (!searchOpen) return null;

  const selectResult = (row: ResultRow) => {
    requestSeq.current++;
    focusNode(row.id, { index: row.passageIndex, text: row.snippet });
    setSearchOpen(false);
  };

  const showSimilarResult = (row: ResultRow) => {
    const count = showSimilarTo(row.id);
    if (count === 0) {
      useUiStore.getState().pushToast('No similar documents in this corpus', 'info');
      return;
    }
    // Prevent a late semantic response from replacing the similar-doc set.
    requestSeq.current += 1;
    setSearchOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, displayedResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      const row = displayedResults[activeIndex];
      if (row) showSimilarResult(row);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = displayedResults[activeIndex];
      if (row) selectResult(row);
    }
    // Escape intentionally left unhandled here so it bubbles to App's
    // window-level listener (owns Esc / closes + clears search results).
  };

  const closeAndClear = () => {
    requestSeq.current++;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchOpen(false);
    setSearchResults(null);
  };

  const showAllInGraph = () => {
    const ids = displayedResults.map((row) => row.id);
    if (ids.length === 0) return;
    // Invalidate any in-flight semantic pass before the overlay unmounts so a
    // late applyResults cannot rewrite this highlight as owner `search`.
    requestSeq.current += 1;
    setSearchResults(ids, 'showMe');
    sendCamera('frameSet', ids);
    setSearchOpen(false);
  };

  const handleDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const input = inputRef.current;
    const closeButton = closeButtonRef.current;
    if (!input || !closeButton) return;
    const cycle: HTMLElement[] = [input, closeButton];
    const showAllButton = showAllButtonRef.current;
    if (showAllButton) cycle.push(showAllButton);
    const index = cycle.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    e.preventDefault();
    const next = e.shiftKey
      ? cycle[(index - 1 + cycle.length) % cycle.length]
      : cycle[(index + 1) % cycle.length];
    next.focus();
  };

  return (
    <div className="search-backdrop" onMouseDown={closeAndClear}>
      <div
        className="search-overlay glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search documents"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="search-overlay__input-row">
          <input
            ref={inputRef}
            className="search-overlay__input"
            type="text"
            role="combobox"
            aria-expanded={hasDisplayedResults}
            aria-controls="search-overlay-results"
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-keyshortcuts="Alt+Enter"
            aria-label="Search your documents by meaning, not just keywords"
            value={query}
            title="Search your documents by meaning, not just keywords"
            placeholder="Search documents… (meaning + title)"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <CloseButton
            ref={closeButtonRef}
            title="Close search"
            aria-label="Close search"
            onClick={closeAndClear}
          />
        </div>

        <div
          className="search-overlay__results"
          id="search-overlay-results"
          role="listbox"
          aria-label={browsing ? 'All documents' : 'Search results'}
        >
          {displayedResults.map((row, i) => {
            const node = nodes[nodeIndex[row.id]];
            return (
              <div
                key={row.id}
                id={`search-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`search-result-row${i === activeIndex ? ' is-active' : ''}`}
                title={`${node?.title ?? row.id} — click to open`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectResult(row)}
              >
                <div className="search-result-row__top">
                  <span className="search-result-row__title">
                    {node?.title ?? row.id}
                  </span>
                  <span className={`match-kind-badge kind-${row.matchKind}`}>
                    {browsing ? 'document' : row.matchKind}
                  </span>
                  <button
                    type="button"
                    className="search-result-row__similar"
                    title="Show documents similar to this one (Alt/Option+Enter)"
                    onClick={(e) => {
                      e.stopPropagation();
                      showSimilarResult(row);
                    }}
                  >
                    Similar
                  </button>
                </div>
                {!browsing && (
                  <div className="search-result-row__score-track">
                    <div
                      className="search-result-row__score-fill"
                      style={{ width: `${Math.round(Math.min(1, row.score) * 100)}%` }}
                    />
                  </div>
                )}
                {row.snippet && (
                  <p className="search-result-row__snippet">{row.snippet}</p>
                )}
              </div>
            );
          })}
        </div>

        {!browsing && searching && !hasDisplayedResults && (
          <div className="search-overlay__empty" role="status">
            Searching…
          </div>
        )}
        {!browsing && !hasDisplayedResults && searched && !searching && (
          <div className="search-overlay__empty" role="status">
            {failed
              ? 'Search didn’t complete — try again in a moment.'
              : allowed ? 'No matches within the active filters' : 'No matches — the model may still be loading'}
          </div>
        )}
        {!browsing && displayedResults.length > 1 && (
          <div className="search-overlay__actions">
            <button
              ref={showAllButtonRef}
              type="button"
              className="search-overlay__show-all"
              title="Highlight every match and frame them in the graph"
              onClick={showAllInGraph}
            >
              Show all in graph ({displayedResults.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
