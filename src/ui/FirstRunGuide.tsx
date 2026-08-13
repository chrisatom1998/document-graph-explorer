import { useEffect, useState, type CSSProperties } from 'react';
import { Button } from '@heroui/react/button';
import { AIRGAP } from '../airgap';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';

// v4: shorter core-loop tour after the toolbar was collapsed into menus.
const KEY = 'knowledge-nebula-first-graph-guide-v4';
export const FIRST_RUN_GUIDE_REOPEN_EVENT = 'knowledge-nebula-reopen-first-run-guide';

const TOUR_STEPS = [
  {
    selector: '.nebula-canvas',
    title: 'Explore the map',
    body: 'Drag to orbit, scroll to zoom, and click a node to read it. Notes, tags, and pins live on the document panel when you need them.',
  },
  {
    selector: '.toolbar',
    title: 'Find and shape the view',
    body: 'Search, fit the camera, and add files here. View, Analyze, and Data keep the extra tools — 2D, snapshots, insights, export — one click down, not on the bar.',
  },
  {
    selector: '.filter-bar-layer',
    title: 'Reduce visual noise',
    body: 'Open Filters for file type and cluster. More filters hides weaker links, connection kinds, and recency until you ask.',
  },
  {
    selector: '.chat-bubble-btn, .chat-panel',
    title: 'Ask the corpus',
    body: 'Open chat for grounded answers that cite the documents used. Answers can come from local passages, OpenRouter, or a fully local Ollama model — pick a provider in Settings.',
    /** Airgap/offline builds must not advertise cloud providers. */
    offlineBody:
      'Open chat for grounded answers extracted from your documents, with citations to the passages used.',
  },
] as const;

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function FirstRunGuide() {
  const ready = useGraphStore((state) => state.phase === 'ready' && state.nodes.length > 0);
  const selectedId = useUiStore((state) => state.selectedId);
  const offlineMode = useSettingsStore((state) => state.offlineMode);
  const [dismissed, setDismissed] = useState(true);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(KEY) === 'dismissed');
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    const reopen = () => {
      try {
        localStorage.removeItem(KEY);
      } catch {
        // Best effort: the in-memory state still reopens the tour.
      }
      setStep(0);
      setDismissed(false);
    };
    window.addEventListener(FIRST_RUN_GUIDE_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(FIRST_RUN_GUIDE_REOPEN_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (!ready || dismissed || selectedId !== null) return;
    const update = () => {
      const target = document.querySelector<HTMLElement>(TOUR_STEPS[step].selector);
      if (!target) {
        setSpotlight(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setSpotlight({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
    };
  }, [dismissed, ready, selectedId, step]);

  const visible = ready && !dismissed && selectedId === null;

  const close = () => {
    try {
      localStorage.setItem(KEY, 'dismissed');
    } catch {
      // The tour still closes for this session when storage is unavailable.
    }
    setDismissed(true);
  };

  // Escape dismisses the tour, and must win over the global Escape ladder
  // (camera overview) while the tour is up — capture phase for that.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible]);

  if (!visible) return null;

  const current = TOUR_STEPS[step];
  const offline = AIRGAP || offlineMode;
  const body = offline && 'offlineBody' in current ? current.offlineBody : current.body;
  const spotlightStyle: CSSProperties | undefined = spotlight
    ? {
        top: Math.max(6, spotlight.top - 6),
        left: Math.max(6, spotlight.left - 6),
        width: Math.max(0, spotlight.width + 12),
        height: Math.max(0, spotlight.height + 12),
      }
    : undefined;

  return (
    <div className="first-run-tour" aria-live="polite">
      {spotlight && spotlight.width > 0 && spotlight.height > 0 && (
        <div className="first-run-spotlight" style={spotlightStyle} aria-hidden="true" />
      )}
      <aside className="first-run-guide glass-panel" aria-label="Getting started">
        <button
          type="button"
          className="first-run-guide__close"
          onClick={close}
          aria-label="Dismiss getting started"
        >
          ×
        </button>
        <span className="first-run-guide__step">Step {step + 1} of {TOUR_STEPS.length}</span>
        <strong>{current.title}</strong>
        <p>{body}</p>
        <div className="first-run-guide__actions">
          <Button
            className="first-run-guide__back"
            variant="tertiary"
            size="sm"
            isDisabled={step === 0}
            onPress={() => setStep((value) => Math.max(0, value - 1))}
          >
            Back
          </Button>
          {step < TOUR_STEPS.length - 1 ? (
            <Button
              className="first-run-guide__done"
              variant="primary"
              size="sm"
              onPress={() => setStep((value) => value + 1)}
            >
              Next
            </Button>
          ) : (
            <Button className="first-run-guide__done" variant="primary" size="sm" onPress={close}>
              Got it
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}
