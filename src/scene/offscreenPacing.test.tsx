// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSceneOnScreen, useSceneOnScreen } from './offscreenPacing';

let report: (visible: boolean) => void = () => undefined;
const disconnect = vi.fn();

function Probe({ onValue }: { onValue: (visible: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  onValue(useSceneOnScreen(ref));
  return <div ref={ref} />;
}

describe('useSceneOnScreen', () => {
  beforeEach(() => {
    disconnect.mockClear();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        report = visible => callback([{ isIntersecting: visible }]);
      }
      observe() { /* the test drives the callback */ }
      disconnect = disconnect;
    });
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('follows the canvas in and out of view and resets on unmount', () => {
    const values: boolean[] = [];
    const { unmount } = render(<Probe onValue={v => values.push(v)} />);
    expect(values.at(-1)).toBe(true);
    expect(isSceneOnScreen()).toBe(true);

    act(() => report(false));
    expect(values.at(-1)).toBe(false);
    expect(isSceneOnScreen()).toBe(false);

    act(() => report(true));
    expect(values.at(-1)).toBe(true);

    act(() => report(false));
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(isSceneOnScreen()).toBe(true);
  });

  it('counts as in view where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const values: boolean[] = [];
    render(<Probe onValue={v => values.push(v)} />);
    expect(values.at(-1)).toBe(true);
    expect(isSceneOnScreen()).toBe(true);
  });
});
