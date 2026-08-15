/**
 * "Notes & Tags" side-panel section: user-authored note, tag chips, and a
 * pin toggle for the selected document. Follows the DocAiSection contract —
 * renders its own side-panel__section wrapper; the parent mounts it with
 * key={node.id} so per-selection state resets.
 *
 * Annotations persist per corpus (see annotationStore) keyed by the doc's
 * stable path/title key, so an edited file keeps its notes. The editor only
 * renders for a local corpus — an imported/shared graph has no corpus record
 * to save into, so the section explains that instead of disappearing.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  annotationKey,
  emptyAnnotation,
  ensureAnnotationsLoaded,
  flushAnnotationSave,
  useAnnotationStore,
} from '../store/annotationStore';
import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';

interface NotesTagsSectionProps {
  docKey: string;
}

export default function NotesTagsSection({ docKey }: NotesTagsSectionProps) {
  const corpusId = useCorpusStore((s) => s.activeCorpusId);
  const mode = useCorpusStore((s) => s.mode);
  const scope = useAnnotationStore((s) => s.scope);
  const annotation = useAnnotationStore((s) => s.annotations[docKey]);
  const update = useAnnotationStore((s) => s.update);
  const allAnnotations = useAnnotationStore((s) => s.annotations);
  const nodes = useGraphStore((s) => s.nodes);
  const [tagDraft, setTagDraft] = useState('');

  // Annotations outlive removed documents by design, but their tags must not
  // haunt the suggestion list — suggest only from docs still in the graph.
  const liveKeys = useMemo(
    () => new Set(nodes.filter((n) => n.kind === 'document').map((n) => annotationKey(n))),
    [nodes],
  );

  useEffect(() => {
    if (mode === 'local' && corpusId) void ensureAnnotationsLoaded(corpusId);
  }, [mode, corpusId]);

  // Land any debounced write when the panel closes / selection changes.
  useEffect(() => () => void flushAnnotationSave(), []);

  if (mode !== 'local') {
    return (
      <div className="side-panel__section">
        <p className="side-panel__section-label">Notes &amp; Tags</p>
        <p className="side-panel__summary is-fallback">
          Notes and tags are saved on this device for local corpora. They are
          not available on imported or shared graphs.
        </p>
      </div>
    );
  }
  if (!corpusId || scope !== corpusId) return null;

  const current = annotation ?? emptyAnnotation();

  // Corpus-wide tags not yet on this doc, as one-click suggestions.
  const suggestions = [
    ...new Set(
      Object.entries(allAnnotations)
        .filter(([key]) => liveKeys.has(key))
        .flatMap(([, a]) => a.tags)
        .filter((tag) => !current.tags.includes(tag)),
    ),
  ].slice(0, 8);

  // Comma is a separator on every commit path (typed, pasted, suggestion).
  const addTag = (raw: string) => {
    setTagDraft(''); // clear even when rejected, so a stale draft can't linger
    const incoming = [
      ...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean)),
    ].filter((tag) => !current.tags.includes(tag));
    if (incoming.length === 0) return;
    update(docKey, { tags: [...current.tags, ...incoming] });
  };

  return (
    <div className="side-panel__section">
      <div className="side-panel__notes-head">
        <p className="side-panel__section-label">Notes &amp; Tags</p>
        <button
          type="button"
          className={`chip chip-selectable${current.pinned ? ' is-active' : ''}`}
          aria-pressed={current.pinned}
          title={current.pinned ? 'Unpin this document' : 'Pin this document'}
          onClick={() => update(docKey, { pinned: !current.pinned })}
        >
          {current.pinned ? '★ Pinned' : '☆ Pin'}
        </button>
      </div>
      <textarea
        className="side-panel__note-input"
        value={current.note}
        onChange={(e) => update(docKey, { note: e.target.value })}
        placeholder="Add a note about this document…"
        aria-label="Document note"
        rows={3}
      />
      <div className="side-panel__chip-row">
        {current.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className="chip chip-selectable is-active"
            aria-label={`Remove tag ${tag}`}
            title={`Remove tag "${tag}"`}
            onClick={() => update(docKey, { tags: current.tags.filter((t) => t !== tag) })}
          >
            {tag} ✕
          </button>
        ))}
        <input
          className="side-panel__tag-input"
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            // Mid-IME-composition, Enter accepts a candidate and ',' can be
            // part of the pre-edit buffer — those keystrokes belong to the
            // IME, not us.
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(tagDraft);
            }
          }}
          // Deliberately NO blur commit: committing on blur saves half-typed
          // tags and the resulting chip-row reflow can eat the very click the
          // user was aiming at. An uncommitted draft stays visible instead.
          placeholder="Add tag…"
          aria-label="Add a tag"
          spellCheck={false}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="side-panel__chip-row side-panel__tag-suggestions">
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip chip-muted chip-selectable"
              title={`Add tag "${tag}"`}
              onClick={() => addTag(tag)}
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
