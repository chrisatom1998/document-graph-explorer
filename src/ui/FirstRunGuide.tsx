import { useEffect, useState, type CSSProperties } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const KEY = 'knowledge-nebula-first-graph-guide-v2';
export const FIRST_RUN_GUIDE_REOPEN_EVENT = 'knowledge-nebula-reopen-first-run-guide';

const TOUR_STEPS = [
  {
    selector: '.nebula-canvas',
    title: 'Explore the map',
    body: 'Drag to orbit, scroll to zoom, and select a node to read the source behind it.',
  },
  {
    selector: '.toolbar',
    title: 'Find and shape the view',
    body: 'Search, trace paths, switch between 2D and 3D, collapse clusters, save snapshots, and add files here.',
  },
  {
    selector: '.filter-bar-layer',
    title: 'Reduce visual noise',
    body: 'Open Filters to focus by file type or cluster, or raise Link Strength to hide weaker connections.',
  },
  {
    selector: '.chat-bubble-btn',
    title: 'Ask the corpus',
    body: 'Open chat for grounded answers that cite the documents and passages used.',
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

  if (!ready || dismissed || selectedId !== null) return null;

  const close = () => {
    try {
      localStorage.setItem(KEY, 'dismissed');
    } catch {
      // The tour still closes for this session when storage is unavailable.
    }
    setDismissed(true);
  };

  const current = TOUR_STEPS[step];
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
        <p>{current.body}</p>
        <div className="first-run-guide__actions">
          <button
            type="button"
            className="first-run-guide__back"
            disabled={step === 0}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
          >
            Back
          </button>
          {step < TOUR_STEPS.length - 1 ? (
            <button
              type="button"
              className="first-run-guide__done"
              onClick={() => setStep((value) => value + 1)}
            >
              Next
            </button>
          ) : (
            <button type="button" className="first-run-guide__done" onClick={close}>
              Got it
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
