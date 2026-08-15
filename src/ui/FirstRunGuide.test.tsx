// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import FirstRunGuide, { FIRST_RUN_GUIDE_REOPEN_EVENT } from './FirstRunGuide';

const node: DocNode = {
  id: 'doc',
  kind: 'document',
  title: 'Document',
  fileType: 'txt',
  topics: [],
  entities: [],
  keywords: [],
  wordCount: 10,
  cluster: 0,
  degree: 0,
  status: 'ok',
};

describe('FirstRunGuide', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('first-run-guide')) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 330,
          bottom: 192,
          width: 330,
          height: 192,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 32,
        y: 48,
        top: 48,
        left: 32,
        right: 232,
        bottom: 148,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      } as DOMRect;
    });
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 900 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 700 });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      writable: true,
      configurable: true,
      value: vi.fn(),
    });
    useGraphStore.setState({
      nodes: [node],
      nodeIndex: { doc: 0 },
      edges: [],
      phase: 'ready',
    });
    useUiStore.setState({ selectedId: null });
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
  });

  it('gets out of the way while document details are open', async () => {
    render(<FirstRunGuide />);
    expect(await screen.findByLabelText('Getting started')).toBeVisible();

    act(() => useUiStore.getState().setSelected('doc'));

    expect(screen.queryByLabelText('Getting started')).not.toBeInTheDocument();
  });

  it('can be reopened after dismissal', async () => {
    render(<FirstRunGuide />);
    const guide = await screen.findByLabelText('Getting started');
    expect(guide).toBeVisible();

    await act(async () => {
      screen.getByRole('button', { name: 'Dismiss getting started' }).click();
    });
    expect(screen.queryByLabelText('Getting started')).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event(FIRST_RUN_GUIDE_REOPEN_EVENT));
    });

    expect(await screen.findByLabelText('Getting started')).toBeVisible();
  });

  it('walks through focused learning steps', async () => {
    render(<FirstRunGuide />);
    expect(await screen.findByText('Explore the map')).toBeVisible();

    await act(async () => screen.getByRole('button', { name: 'Next' }).click());
    expect(screen.getByText('Find and shape the view')).toBeVisible();
    expect(screen.getByText('Step 2 of 4')).toBeVisible();

    await act(async () => screen.getByRole('button', { name: 'Back' }).click());
    expect(screen.getByText('Explore the map')).toBeVisible();
  });

  it('teaches the core loop, ending on chat', async () => {
    render(<FirstRunGuide />);
    await screen.findByText('Explore the map');

    const seen: string[] = [];
    for (;;) {
      seen.push(screen.getByRole('strong').textContent ?? '');
      const next = screen.queryByRole('button', { name: 'Next' });
      if (!next) break;
      await act(async () => next.click());
    }

    expect(seen).toEqual([
      'Explore the map',
      'Find and shape the view',
      'Reduce visual noise',
      'Ask the corpus',
    ]);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeVisible();
  });

  it('rests left of the minimap by default', async () => {
    render(<FirstRunGuide />);
    const guide = await screen.findByLabelText('Getting started');
    expect(guide).toHaveStyle({ left: '334px', top: '490px' });
  });

  it('restores a saved drag position and clamps it on resize', async () => {
    localStorage.setItem('knowledge-nebula-first-run-guide-pos', JSON.stringify({ x: 640, y: 620 }));
    render(<FirstRunGuide />);
    const guide = await screen.findByLabelText('Getting started');
    expect(guide).toHaveStyle({ left: '552px', top: '490px' });

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 520 });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 420 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(guide).toHaveStyle({ left: '172px', top: '210px' });
  });

  it('persists the final drag position on lost pointer capture', async () => {
    render(<FirstRunGuide />);
    const grip = await screen.findByTitle('Drag to move');
    await screen.findByLabelText('Getting started');

    fireEvent.pointerDown(grip, { clientX: 440, clientY: 510, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: 560, clientY: 290, pointerId: 1 });

    fireEvent(grip, new Event('lostpointercapture', { bubbles: true }));
    expect(localStorage.getItem('knowledge-nebula-first-run-guide-pos')).toBeTruthy();
    expect(() =>
      JSON.parse(localStorage.getItem('knowledge-nebula-first-run-guide-pos') ?? 'null'),
    ).not.toThrow();
  });
});
