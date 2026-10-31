// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openFilePicker } from '../ingest/DropZone';
import { openFolderPicker } from '../ingest/folderPicker';
import { loadDemoCorpus } from '../pipeline/coordinatorLazy';
import { useUiStore } from '../store/uiStore';
import { openGraphJsonPicker } from './ExportImportMenu';
import EmptyState from './EmptyState';

vi.mock('../ingest/DropZone', () => ({ openFilePicker: vi.fn() }));
vi.mock('../ingest/folderPicker', () => ({ openFolderPicker: vi.fn() }));
vi.mock('../pipeline/coordinatorLazy', () => ({ loadDemoCorpus: vi.fn(async () => {}) }));
vi.mock('./ExportImportMenu', () => ({
  openGraphJsonPicker: vi.fn(),
  importGraphJsonFileWithToast: vi.fn(),
}));

const WORKSPACE_TOOLS = [
  'Graph and Library',
  'Sounds',
  'Documents',
  'Filters',
  'More tools',
  'Export',
] as const;

describe('EmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ settingsOpen: false, helpOpen: false, toasts: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('describes sounds and documents and only offers real entry points', async () => {
    render(<EmptyState />);

    expect(screen.getByRole('heading', { level: 1, name: 'See how sounds and documents relate.' })).toBeVisible();
    expect(screen.getByText(/100 sample documents, not audio/)).toBeVisible();
    expect(screen.getByText(/Nothing is uploaded unless you turn on a cloud AI provider/)).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/serato/i)).not.toBeInTheDocument();

    for (const name of WORKSPACE_TOOLS) {
      expect(screen.getByRole('heading', { name })).toBeVisible();
    }
    expect(screen.getByRole('region', { name: 'In the workspace' })).toHaveTextContent('Sample assistant');
    expect(screen.getByRole('region', { name: 'In the workspace' })).toHaveTextContent('Ask about your library');
    expect(screen.getByRole('region', { name: 'In the workspace' })).toHaveTextContent('Rekordbox');
    expect(screen.getByRole('region', { name: 'In the workspace' })).toHaveTextContent(/Add files, load the demo, or import a graph/);

    expect(await screen.findByRole('button', { name: /Current corpus/ })).toBeVisible();

    const art = document.querySelector('.empty-state__art img');
    expect(art).toBeTruthy();
    expect(art).toHaveAttribute('alt', '');
    expect(art?.getAttribute('srcset')).toMatch(/960w/);
    expect(art?.getAttribute('srcset')).toMatch(/1920w/);
    expect(document.querySelector('.empty-state__art source')?.getAttribute('type')).toBe('image/webp');
    expect(document.querySelector('.empty-state__constellation')).toBeNull();
  });

  it('opens the file pickers, demo, importer, settings and help', async () => {
    render(<EmptyState />);

    const names = ['Add files', 'Add a folder', 'Load demo corpus', 'Import a graph', 'Settings', 'Help'];
    for (const name of names) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeEnabled();
      button.focus();
      expect(button).toHaveFocus();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Add files' }));
    expect(openFilePicker).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add a folder' }));
    expect(openFolderPicker).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Load demo corpus' }));
    await waitFor(() => expect(loadDemoCorpus).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Import a graph' }));
    await waitFor(() => expect(openGraphJsonPicker).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(useUiStore.getState().settingsOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(useUiStore.getState().helpOpen).toBe(true);
  });
});
