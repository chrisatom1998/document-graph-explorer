// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { useChatStore } from '../store/chatStore';
import ChatPanel from './ChatPanel';
import FirstRunGuide from './FirstRunGuide';
import HelpPopover from './HelpPopover';
import InsightsPanel from './InsightsPanel';
import PathPanel from './PathPanel';
import SearchOverlay from './SearchOverlay';
import SettingsPanel from './SettingsPanel';
import SidePanel from './SidePanel';
import SnapshotDrawer from './SnapshotDrawer';

describe('Accessibility Verification: CloseButton across all 9 UI Panels', () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    useGraphStore.setState({
      nodes: [
        {
          id: 'doc-1',
          kind: 'document',
          title: 'Doc 1',
          fileType: 'txt',
          topics: [],
          entities: [],
          keywords: [],
          wordCount: 10,
          cluster: 0,
          degree: 0,
          status: 'ok',
        },
        {
          id: 'doc-2',
          kind: 'document',
          title: 'Doc 2',
          fileType: 'txt',
          topics: [],
          entities: [],
          keywords: [],
          wordCount: 20,
          cluster: 0,
          degree: 0,
          status: 'ok',
        },
      ],
      nodeIndex: { 'doc-1': 0, 'doc-2': 1 },
      edges: [],
      phase: 'ready',
    });
  });

  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
  });

  it('1. ChatPanel has accessible close button', () => {
    useChatStore.setState({ isOpen: true });
    render(<ChatPanel />);
    const btn = screen.getByRole('button', { name: 'Close chat' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close chat');
    expect(btn).toHaveClass('icon-btn-close');
  });

  it('2. FirstRunGuide has accessible close button', async () => {
    render(<FirstRunGuide />);
    const btn = await screen.findByRole('button', { name: 'Dismiss getting started' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Dismiss getting started');
  });

  it('3. HelpPopover has accessible close button', () => {
    useUiStore.setState({ helpOpen: true });
    render(<HelpPopover />);
    const btn = screen.getByRole('button', { name: 'Close help' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close help');
  });

  it('4. InsightsPanel has accessible close button', () => {
    useUiStore.setState({ insightsOpen: true });
    render(<InsightsPanel />);
    const btn = screen.getByRole('button', { name: 'Close insights' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close insights');
  });

  it('5. PathPanel has accessible close button', () => {
    useUiStore.setState({ pathMode: true });
    render(<PathPanel />);
    const btn = screen.getByRole('button', { name: 'Close path finder' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close path finder');
  });

  it('6. SearchOverlay has accessible close button', () => {
    useUiStore.setState({ searchOpen: true });
    render(<SearchOverlay />);
    const btn = screen.getByRole('button', { name: 'Close search' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close search');
  });

  it('7. SettingsPanel has accessible close button', () => {
    useUiStore.setState({ settingsOpen: true });
    render(<SettingsPanel />);
    const btn = screen.getByRole('button', { name: 'Close settings' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close settings');
  });

  it('8. SidePanel has accessible close button', () => {
    useUiStore.setState({ selectedId: 'doc-1' });
    render(<SidePanel />);
    const btn = screen.getByRole('button', { name: 'Back to graph' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Back to graph');
  });

  it('9. SnapshotDrawer has accessible close button', () => {
    useUiStore.setState({ snapshotsOpen: true });
    render(<SnapshotDrawer />);
    const btn = screen.getByRole('button', { name: 'Close snapshots' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close snapshots');
  });
});
