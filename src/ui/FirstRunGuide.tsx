import { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const KEY = 'knowledge-nebula-first-graph-guide-v1';

export default function FirstRunGuide() {
  const ready = useGraphStore((s) => s.phase === 'ready' && s.nodes.length > 0);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(KEY) === 'dismissed'); } catch { setDismissed(false); }
  }, []);

  if (!ready || dismissed) return null;
  const close = () => {
    try { localStorage.setItem(KEY, 'dismissed'); } catch { /* best effort */ }
    setDismissed(true);
  };

  return (
    <aside className="first-run-guide glass-panel" aria-label="Getting started">
      <button type="button" className="first-run-guide__close" onClick={close} aria-label="Dismiss getting started">×</button>
      <strong>Your document graph is ready</strong>
      <ol>
        <li>Drag to explore the relationships.</li>
        <li><button type="button" onClick={() => useUiStore.getState().setSearchOpen(true)}>Search</button> for a fact or topic.</li>
        <li>Open a node to read its source text.</li>
        <li>Use the AI bubble to ask a grounded question.</li>
      </ol>
      <button type="button" className="first-run-guide__done" onClick={close}>Got it</button>
    </aside>
  );
}
