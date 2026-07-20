import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { searchCorpus, searchCorpusLexical } from '../search/semanticSearch';
import type { RetrievalMatchKind } from '../search/retrieval';
import { focusNode } from './focusNode';
import { useActiveOptionScroll } from './useActiveOptionScroll';

const DEBOUNCE_MS = 250;

interface ResultRow {
  id: string;
  score: number;
  matchKind: RetrievalMatchKind;
  snippet?: string;
}

export default function SearchOverlay() {
  const searchOpen = useUiStore((s) => s.searchOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setSearchResults = useUiStore((s) => s.setSearchResults);

  const nodes = useGraphStore((s) => s.nodes);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searched, setSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  // Reset local state each time the overlay opens; autofocus the input.
  useEffect(() => {
    if (!searchOpen) return;
    setQuery('');
    setResults([]);
    setActiveIndex(0);
    setSearched(false);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length === 0) {
      setResults([]);
      setSearched(false);
      setSearchResults(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      const applyResults = (res: ResultRow[]) => {
          if (seq !== requestSeq.current) return; // stale response
          setResults(res);
          setActiveIndex(0);
          setSearched(true);
          setSearchResults(res.map((r) => r.id), 'search');
      };
      void (async () => {
        try {
          applyResults(await searchCorpusLexical(query));
          applyResults(await searchCorpus(query));
        } catch (err) {
          console.warn('search failed', err);
          if (seq !== requestSeq.current) return;
          setSearched(true);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchOpen]);

  const browsing = query.trim().length === 0;
  const displayedResults: ResultRow[] = browsing
    ? nodes
        .filter((node) => node.kind === 'document')
        .map((node) => ({ id: node.id, score: 0, matchKind: 'title' }))
    : results;
  const hasDisplayedResults = displayedResults.length > 0;
  const activeOptionId = hasDisplayedResults ? `search-option-${activeIndex}` : undefined;
  // Must run before the closed-overlay early return: hooks cannot be
  // conditional, and this list is only rendered while the overlay is open.
  useActiveOptionScroll(searchOpen ? activeOptionId : undefined);

  if (!searchOpen) return null;

  const selectResult = (id: string) => {
    focusNode(id);
    setSearchOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, displayedResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = displayedResults[activeIndex];
      if (row) selectResult(row.id);
    }
    // Escape intentionally left unhandled here so it bubbles to App's
    // window-level listener (owns Esc / closes + clears search results).
  };

  const closeAndClear = () => {
    setSearchOpen(false);
    setSearchResults(null);
  };

  const handleDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const input = inputRef.current;
    const closeButton = closeButtonRef.current;
    if (!input || !closeButton) return;
    if (e.shiftKey && document.activeElement === input) {
      e.preventDefault();
      closeButton.focus();
    } else if (!e.shiftKey && document.activeElement === closeButton) {
      e.preventDefault();
      input.focus();
    }
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
            aria-label="Search your documents by meaning, not just keywords"
            value={query}
            title="Search your documents by meaning, not just keywords"
            placeholder="Search your nebula… (semantic + title)"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-btn-close"
            title="Close search"
            aria-label="Close search"
            onClick={closeAndClear}
          >
            ×
          </button>
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
                onClick={() => selectResult(row.id)}
              >
                <div className="search-result-row__top">
                  <span className="search-result-row__title">
                    {node?.title ?? row.id}
                  </span>
                  <span className={`match-kind-badge kind-${row.matchKind}`}>
                    {browsing ? 'document' : row.matchKind}
                  </span>
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

          {results.length === 0 && searched && (
            <div className="search-overlay__empty">
              No matches — the model may still be loading
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
