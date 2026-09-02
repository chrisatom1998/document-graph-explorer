/**
 * React access to a document's full text now that textStore is evictable
 * (see store/textHydration). Mirrors SidePanelReader's async getOriginal
 * pattern: the warm cache answers synchronously; an evicted-but-persisted
 * body hydrates in an effect and re-renders when it lands.
 *
 * `loading` is true only while a hydration for this doc is in flight, so
 * callers can show a spinner instead of flashing "text unavailable" —
 * `text === undefined && !loading` is a confirmed miss.
 */

import { useEffect, useState } from 'react';
import { textStore } from '../store/runtimeStores';
import { getDocText, hasDocTextSync } from '../store/textHydration';

export interface DocTextState {
  text: string | undefined;
  loading: boolean;
}

export function useDocText(docId: string | null | undefined): DocTextState {
  const warm = docId ? textStore.get(docId) : undefined;
  const [hydrated, setHydrated] = useState<{ id: string; text: string | undefined } | null>(null);
  const needsHydration = docId !== null && docId !== undefined && warm === undefined && hasDocTextSync(docId);

  useEffect(() => {
    if (!docId || !needsHydration) return;
    let cancelled = false;
    void getDocText(docId).then((text) => {
      if (!cancelled) setHydrated({ id: docId, text });
    });
    return () => {
      cancelled = true;
    };
  }, [docId, needsHydration]);

  if (warm !== undefined) return { text: warm, loading: false };
  if (docId && hydrated?.id === docId) return { text: hydrated.text, loading: false };
  return { text: undefined, loading: needsHydration };
}
