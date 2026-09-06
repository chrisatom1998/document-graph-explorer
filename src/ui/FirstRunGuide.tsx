import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Button } from '@heroui/react/button';
import { AIRGAP } from '../airgap';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useUiStore } from '../store/uiStore';
import CloseButton from './CloseButton';
import { IconGrip } from './icons';
import { FIRST_RUN_GUIDE_REOPEN_EVENT } from './uiEvents';

// v4: shorter core-loop tour after the toolbar was collapsed into menus.
const KEY = 'knowledge-nebula-first-graph-guide-v4';
export { FIRST_RUN_GUIDE_REOPEN_EVENT };

const TOUR_STEPS = [
  {
    selector: '.nebula-canvas',
    title: 'Explore the map',
    body: 'Drag to orbit, scroll to zoom, and click a node to read it. Notes, tags, and pins live on the document panel when you need them.',
  },
  {
    selector: '.toolbar',
    title: 'Find and shape the view',
    body: 'Search, fit the camera, switch between the 2D map and 3D space, and add files here. View, Analyze, and Data keep snapshots, insights, export, and other tools one click down.',
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

/** Dragged guide position, persisted across reloads (same contract as the toolbar). */
const POS_KEY = 'knowledge-nebula-first-run-guide-pos';
const GUIDE_MARGIN = 18;
/** Matches the enlarged minimap clearance plus a small visual gap. */
const GUIDE_RIGHT_INSET = 256;

function loadGuidePos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function saveGuidePos(pos: { x: number; y: number }): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* private mode / quota exceeded — position simply won't persist */
  }
}

/**
 * Pin the guide at (x, y) in viewport coordinates, clamped inside the visible
 * area. Written as explicit left/top so the panel can never inherit a stale
 * right/bottom anchor that pushes it out of view.
 */
function placeGuide(el: HTMLElement, x: number, y: number): { x: number; y: number } {
  const { width, height } = el.getBoundingClientRect();
  const maxX = Math.max(GUIDE_MARGIN, window.innerWidth - width - GUIDE_MARGIN);
  const maxY = Math.max(GUIDE_MARGIN, window.innerHeight - height - GUIDE_MARGIN);
  const cx = Math.min(Math.max(x, GUIDE_MARGIN), maxX);
  const cy = Math.min(Math.max(y, GUIDE_MARGIN), maxY);
  el.style.left = `${cx}px`;
  el.style.top = `${cy}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  return { x: cx, y: cy };
}

/** Bottom-right resting spot, left of the minimap, measured from the live element size. */
function defaultGuidePos(el: HTMLElement): { x: number; y: number } {
  const { width, height } = el.getBoundingClientRect();
  return {
    x: window.innerWidth - width - GUIDE_RIGHT_INSET,
    y: window.innerHeight - height - GUIDE_MARGIN,
  };
}

export default function FirstRunGuide() {
  const ready = useGraphStore((state) => state.phase === 'ready' && state.nodes.length > 0);
  const selectedId = useUiStore((state) => state.selectedId);
  const searchOpen = useUiStore((state) => state.searchOpen);
  const dims = useUiStore((state) => state.dims);
  const offlineMode = useSettingsStore((state) => state.offlineMode);
  const [dismissed, setDismissed] = useState(true);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const guideRef = useRef<HTMLElement | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);

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
    if (!ready || dismissed || selectedId !== null || searchOpen) return;
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
  }, [dismissed, ready, selectedId, searchOpen, step]);

  const visible = ready && !dismissed && selectedId === null && !searchOpen;

  // Place the panel imperatively once it is on screen: a saved drag position
  // when there is one, otherwise the measured bottom-right corner. Measuring
  // the live element (instead of trusting a CSS right/bottom anchor) is what
  // guarantees the whole panel lands inside the viewport.
  useLayoutEffect(() => {
    const el = guideRef.current;
    if (!visible || !el) return;
    const saved = posRef.current ?? loadGuidePos();
    const target = saved ?? defaultGuidePos(el);
    posRef.current = placeGuide(el, target.x, target.y);
  }, [visible, step]);

  // Keep the panel reachable when the window shrinks under its saved position.
  useEffect(() => {
    if (!visible) return;
    const onResize = () => {
      const el = guideRef.current;
      if (!el) return;
      const current = posRef.current ?? defaultGuidePos(el);
      posRef.current = placeGuide(el, current.x, current.y);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [visible]);

  const handleDragStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = guideRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handleDragMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragOffset.current;
    const el = guideRef.current;
    if (!drag || !el) return;
    posRef.current = placeGuide(el, e.clientX - drag.dx, e.clientY - drag.dy);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragOffset.current && posRef.current) saveGuidePos(posRef.current);
    dragOffset.current = null;
  }, []);

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
      // Open graph controls own Escape so their local handlers can restore focus.
      if (e.target instanceof Element) {
        const navigator = e.target.closest('.graph-navigator.is-expanded');
        const filters = e.target.closest('.filter-bar-layer')?.querySelector('#graph-filter-panel');
        if (navigator || filters) return;
      }
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [visible]);

  if (!visible) return null;

  const current = TOUR_STEPS[step];
  const offline = AIRGAP || offlineMode;
  const modeAwareBody =
    step === 0 && dims === 2
      ? 'Drag empty space to pan, scroll to zoom, and click a node to read it. Notes, tags, and pins live on the document panel when you need them.'
      : current.body;
  const body = offline && 'offlineBody' in current ? current.offlineBody : modeAwareBody;
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
      <aside ref={guideRef} className="first-run-guide glass-panel" aria-label="Getting started">
        <CloseButton
          className="first-run-guide__close"
          aria-label="Dismiss getting started"
          onClick={close}
        />
        <div
          className="first-run-guide__drag"
          title="Drag to move"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onLostPointerCapture={handleDragEnd}
        >
          <span className="first-run-guide__grip" aria-hidden="true"><IconGrip /></span>
          <span className="first-run-guide__step">Step {step + 1} of {TOUR_STEPS.length}</span>
        </div>
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
