import { useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { rememberCenterOrigin } from '../scene/ingestGesture';
import { FIRST_RUN_GUIDE_REOPEN_EVENT } from './uiEvents';

export type DemoKind = 'docs' | 'audio';

/**
 * Loads one of the bundled demos. The document demo fetches its manifest before
 * the pipeline phase changes, so a busy state (and a lock against a second
 * click) keeps the button from looking dead or queueing another ingest.
 */
export function useDemoLoader() {
  const lock = useRef<DemoKind | null>(null);
  const [loading, setLoading] = useState<DemoKind | null>(null);
  const load = (kind: DemoKind) => {
    if (lock.current) return;
    lock.current = kind;
    setLoading(kind);
    rememberCenterOrigin();
    import('../pipeline/coordinatorLazy')
      .then((mod) => (kind === 'docs' ? mod.loadDemoCorpus() : mod.loadDemoAudio()))
      .then(() => {
        // A mid-run cancellation resolves the promise but leaves nodes empty.
        if (useGraphStore.getState().nodes.length > 0) window.dispatchEvent(new Event(FIRST_RUN_GUIDE_REOPEN_EVENT));
      })
      .catch((err) => {
        console.warn(kind === 'docs' ? 'demo corpus load failed' : 'audio demo load failed', err);
        useUiStore.getState().pushToast(kind === 'docs' ? "Couldn't load the demo corpus." : "Couldn't load the audio demo.");
      })
      .finally(() => { lock.current = null; setLoading(null); });
  };
  return { loading, load };
}
