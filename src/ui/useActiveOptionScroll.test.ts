// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { useActiveOptionScroll } from './useActiveOptionScroll';

describe('useActiveOptionScroll custom hook', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('calls scrollIntoView with block: "nearest" on active option element', () => {
    const opt = document.createElement('div');
    opt.id = 'option-1';
    const scrollMock = vi.fn();
    opt.scrollIntoView = scrollMock;
    document.body.appendChild(opt);

    renderHook(({ id }) => useActiveOptionScroll(id), {
      initialProps: { id: 'option-1' as string | undefined },
    });

    expect(scrollMock).toHaveBeenCalledTimes(1);
    expect(scrollMock).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('does nothing when activeOptionId is undefined or empty', () => {
    const opt = document.createElement('div');
    opt.id = 'option-1';
    const scrollMock = vi.fn();
    opt.scrollIntoView = scrollMock;
    document.body.appendChild(opt);

    const { rerender } = renderHook(({ id }) => useActiveOptionScroll(id), {
      initialProps: { id: undefined as string | undefined },
    });

    expect(scrollMock).not.toHaveBeenCalled();

    rerender({ id: '' });
    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('handles non-existent DOM element ID gracefully without throwing', () => {
    expect(() => {
      renderHook(() => useActiveOptionScroll('non-existent-id'));
    }).not.toThrow();
  });

  it('scrolls new element when activeOptionId changes', () => {
    const opt1 = document.createElement('div');
    opt1.id = 'option-1';
    const scrollMock1 = vi.fn();
    opt1.scrollIntoView = scrollMock1;

    const opt2 = document.createElement('div');
    opt2.id = 'option-2';
    const scrollMock2 = vi.fn();
    opt2.scrollIntoView = scrollMock2;

    document.body.appendChild(opt1);
    document.body.appendChild(opt2);

    const { rerender } = renderHook(({ id }) => useActiveOptionScroll(id), {
      initialProps: { id: 'option-1' },
    });

    expect(scrollMock1).toHaveBeenCalledTimes(1);
    expect(scrollMock2).not.toHaveBeenCalled();

    rerender({ id: 'option-2' });

    expect(scrollMock2).toHaveBeenCalledTimes(1);
    expect(scrollMock2).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('safely handles missing scrollIntoView function (optional chaining protection)', () => {
    const opt = document.createElement('div');
    opt.id = 'option-no-scroll';
    // Explicitly delete scrollIntoView to simulate environment without it
    delete (opt as unknown as Record<string, unknown>).scrollIntoView;
    document.body.appendChild(opt);

    expect(() => {
      renderHook(() => useActiveOptionScroll('option-no-scroll'));
    }).not.toThrow();
  });
});
