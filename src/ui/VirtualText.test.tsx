// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import VirtualText from './VirtualText';

// jsdom has no layout engine, so ResizeObserver isn't implemented and every
// element reports a zero content rect regardless of how much text wraps.
// Mock it so we can simulate a block that wrapped onto multiple visual
// lines under white-space: pre-wrap, and drive the callback manually.
type RoCallback = (entries: Partial<ResizeObserverEntry>[]) => void;

let observedElements: HTMLElement[] = [];
let roCallback: RoCallback | null = null;

class MockResizeObserver {
  callback: RoCallback;
  constructor(callback: RoCallback) {
    this.callback = callback;
    roCallback = callback;
  }
  observe(el: Element) {
    observedElements.push(el as HTMLElement);
  }
  unobserve(el: Element) {
    observedElements = observedElements.filter((e) => e !== el);
  }
  disconnect() {
    observedElements = [];
  }
}

function fireResize(el: HTMLElement, height: number): void {
  act(() => {
    roCallback?.([
      {
        target: el,
        contentRect: { height } as DOMRectReadOnly,
        borderBoxSize: [{ blockSize: height, inlineSize: 0 }] as unknown as readonly ResizeObserverSize[],
      },
    ]);
  });
}

describe('VirtualText', () => {
  beforeEach(() => {
    observedElements = [];
    roCallback = null;
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders short text without virtualizing', () => {
    const { container } = render(<VirtualText text="line1\nline2" />);
    expect(container.textContent).toContain('line1');
  });

  it('virtualizes a long document and only mounts a windowed slice of blocks', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    const { container } = render(<VirtualText text={lines.join('\n')} />);
    // 600 lines / 60 lines-per-block = 10 blocks; far fewer than 10 should
    // be mounted at once (viewport + buffer), not all of them.
    const blocks = container.querySelectorAll('[data-block-index]');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.length).toBeLessThan(10);
  });

  it('registers a ResizeObserver on each rendered block', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    render(<VirtualText text={lines.join('\n')} />);
    expect(observedElements.length).toBeGreaterThan(0);
  });

  it('uses a block\'s MEASURED height (not the fixed per-line estimate) to decide which blocks are visible after scrolling — the actual wrapped-line bug', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    const { container } = render(<VirtualText text={lines.join('\n')} />);

    const scrollable = container.firstElementChild as HTMLElement;
    const block0 = observedElements.find((el) => el.dataset.blockIndex === '0');
    expect(block0).toBeDefined();

    // Simulate block 0 having wrapped onto many more visual lines than the
    // BLOCK_LINES*LINE_HEIGHT_PX estimate (~1332px) — e.g. one pathologically
    // long unwrapped source line under white-space: pre-wrap.
    if (block0) fireResize(block0, 100_000);

    // Scroll to an offset that is still well within block 0's *measured*
    // span (100,000px) but far past where the OLD fixed-height math would
    // have placed the scroll — under the buggy fixed-line assumption this
    // offset would map to ~block 4, evicting block 0 from the render window
    // entirely.
    fireEvent.scroll(scrollable, { target: { scrollTop: 6000 } });

    const rendered = [...container.querySelectorAll('[data-block-index]')].map(
      (el) => (el as HTMLElement).dataset.blockIndex,
    );
    expect(rendered).toContain('0');
  });

  it('does not throw when ResizeObserver is unavailable (falls back to fixed-line estimates)', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    expect(() => render(<VirtualText text={lines.join('\n')} />)).not.toThrow();
  });
});
