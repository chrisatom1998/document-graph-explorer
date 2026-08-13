// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module Mocks
vi.mock('../persistence/cache', () => ({
  listSnapshots: vi.fn(),
  loadSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
}));

vi.mock('../persistence/session', () => ({
  saveCurrentSnapshot: vi.fn(),
  restoreSnapshotById: vi.fn(),
}));

vi.mock('../graph/snapshotDiff', () => ({
  diffGraphs: vi.fn(),
  formatDiffSummary: vi.fn(),
}));

import { diffGraphs, formatDiffSummary } from '../graph/snapshotDiff';
import { deleteSnapshot, listSnapshots, loadSnapshot, type SnapshotSummary } from '../persistence/cache';
import { restoreSnapshotById, saveCurrentSnapshot } from '../persistence/session';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import SnapshotDrawer from './SnapshotDrawer';

const mockListSnapshots = vi.mocked(listSnapshots);
const mockLoadSnapshot = vi.mocked(loadSnapshot);
const mockDeleteSnapshot = vi.mocked(deleteSnapshot);
const mockSaveCurrentSnapshot = vi.mocked(saveCurrentSnapshot);
const mockRestoreSnapshotById = vi.mocked(restoreSnapshotById);
const mockDiffGraphs = vi.mocked(diffGraphs);
const mockFormatDiffSummary = vi.mocked(formatDiffSummary);

const sampleSnapshots: SnapshotSummary[] = [
  { id: 101, name: 'Baseline Graph', savedAt: 1770000000000, nodeCount: 15 },
  { id: 102, name: 'Single Node Snapshot', savedAt: 1770005000000, nodeCount: 1 },
];

describe('SnapshotDrawer Component Unit Tests', () => {
  let mockPushToast: ReturnType<typeof vi.fn>;
  let mockSetSnapshotOverlay: ReturnType<typeof vi.fn>;
  let mockSetSearchResults: ReturnType<typeof vi.fn>;
  let mockSendCamera: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPushToast = vi.fn();
    mockSetSnapshotOverlay = vi.fn();
    mockSetSearchResults = vi.fn();
    mockSendCamera = vi.fn();

    useUiStore.setState({
      snapshotsOpen: true,
      setSnapshotsOpen: (open: boolean) => useUiStore.setState({ snapshotsOpen: open }),
      pushToast: mockPushToast as unknown as ReturnType<typeof useUiStore.getState>['pushToast'],
      setSnapshotOverlay: mockSetSnapshotOverlay as unknown as ReturnType<typeof useUiStore.getState>['setSnapshotOverlay'],
      setSearchResults: mockSetSearchResults as unknown as ReturnType<typeof useUiStore.getState>['setSearchResults'],
      sendCamera: mockSendCamera as unknown as ReturnType<typeof useUiStore.getState>['sendCamera'],
    });

    useGraphStore.setState({
      phase: 'ready',
      nodes: [
        {
          id: 'doc-1',
          kind: 'document',
          title: 'Document 1',
          fileType: 'md',
          topics: [],
          entities: [],
          keywords: [],
          wordCount: 100,
          cluster: 0,
          degree: 1,
          status: 'ok',
        },
      ],
      edges: [],
    });

    mockListSnapshots.mockReset().mockResolvedValue([]);
    mockLoadSnapshot.mockReset();
    mockDeleteSnapshot.mockReset();
    mockSaveCurrentSnapshot.mockReset();
    mockRestoreSnapshotById.mockReset();
    mockDiffGraphs.mockReset();
    mockFormatDiffSummary.mockReset();
  });

  afterEach(cleanup);

  // --- Suite 1: Drawer Visibility & Dismissal ---
  describe('Drawer Visibility & Dismissal', () => {
    it('renders nothing when snapshotsOpen is false', () => {
      useUiStore.setState({ snapshotsOpen: false });
      const { container } = render(<SnapshotDrawer />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Snapshots' })).not.toBeInTheDocument();
    });

    it('renders dialog container with accessible attributes when open', async () => {
      render(<SnapshotDrawer />);
      const dialog = screen.getByRole('dialog', { name: 'Snapshots' });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByRole('heading', { name: 'Saved Snapshots' })).toBeInTheDocument();
    });

    it('closes drawer when clicking backdrop', () => {
      render(<SnapshotDrawer />);
      const backdrop = screen.getByRole('dialog', { name: 'Snapshots' }).parentElement!;
      fireEvent.click(backdrop);
      expect(useUiStore.getState().snapshotsOpen).toBe(false);
    });

    it('does not close drawer when clicking inside the panel', () => {
      render(<SnapshotDrawer />);
      const dialog = screen.getByRole('dialog', { name: 'Snapshots' });
      fireEvent.click(dialog);
      expect(useUiStore.getState().snapshotsOpen).toBe(true);
    });

    it('closes drawer when clicking header CloseButton', () => {
      render(<SnapshotDrawer />);
      const closeBtn = screen.getByRole('button', { name: 'Close snapshots' });
      fireEvent.click(closeBtn);
      expect(useUiStore.getState().snapshotsOpen).toBe(false);
    });
  });

  // --- Suite 2: Snapshot List Fetching & Display ---
  describe('Snapshot List Rendering', () => {
    it('renders empty state hint when listSnapshots returns empty array', async () => {
      mockListSnapshots.mockResolvedValue([]);
      render(<SnapshotDrawer />);

      await waitFor(() => {
        expect(screen.getByText('No snapshots yet')).toBeInTheDocument();
      });
      expect(
        screen.getByText('Use the save row above to create a snapshot of your current graph.'),
      ).toBeInTheDocument();
    });

    it('fetches and renders list of snapshots with correct node count pluralization', async () => {
      mockListSnapshots.mockResolvedValue(sampleSnapshots);
      render(<SnapshotDrawer />);

      await waitFor(() => {
        expect(screen.getByText('Baseline Graph')).toBeInTheDocument();
      });
      expect(screen.getByText('Single Node Snapshot')).toBeInTheDocument();
      expect(screen.getByText(/15 nodes/)).toBeInTheDocument();
      expect(screen.getByText(/1 node$/)).toBeInTheDocument();
    });
  });

  // --- Suite 3: Snapshot Creation (Save) ---
  describe('Snapshot Creation (Save)', () => {
    it('disables save button when graph phase is not ready', () => {
      useGraphStore.setState({ phase: 'parsing' });
      render(<SnapshotDrawer />);

      const saveBtn = screen.getByRole('button', { name: 'Save' });
      expect(saveBtn).toBeDisabled();
    });

    it('saves snapshot on button click and refreshes list', async () => {
      mockListSnapshots.mockResolvedValue([]);
      mockSaveCurrentSnapshot.mockResolvedValue(201);

      render(<SnapshotDrawer />);
      const input = screen.getByPlaceholderText('Snapshot name');
      fireEvent.change(input, { target: { value: 'My Custom Snapshot' } });

      const saveBtn = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockSaveCurrentSnapshot).toHaveBeenCalledWith('My Custom Snapshot');
      });
      expect(mockListSnapshots).toHaveBeenCalledTimes(2); // Initial open + refresh after save
    });

    it('saves snapshot on Enter key press in input field', async () => {
      mockSaveCurrentSnapshot.mockResolvedValue(202);
      render(<SnapshotDrawer />);

      const input = screen.getByPlaceholderText('Snapshot name');
      fireEvent.change(input, { target: { value: 'Keyboard Saved' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mockSaveCurrentSnapshot).toHaveBeenCalledWith('Keyboard Saved');
      });
    });

    it('shows toast notification on save failure', async () => {
      mockSaveCurrentSnapshot.mockResolvedValue(undefined);
      render(<SnapshotDrawer />);

      const saveBtn = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockPushToast).toHaveBeenCalledWith(
          "Couldn't save the snapshot — storage is unavailable.",
        );
      });
    });
  });

  // --- Suite 4: Snapshot Restoration (Load) ---
  describe('Snapshot Restoration (Load)', () => {
    it('loads snapshot and closes drawer on success', async () => {
      mockListSnapshots.mockResolvedValue(sampleSnapshots);
      mockRestoreSnapshotById.mockResolvedValue(true);

      render(<SnapshotDrawer />);
      const loadBtns = await screen.findAllByTitle('Load this snapshot');

      fireEvent.click(loadBtns[0]);

      await waitFor(() => {
        expect(mockRestoreSnapshotById).toHaveBeenCalledWith(101);
      });
      expect(useUiStore.getState().snapshotsOpen).toBe(false);
    });

    it('shows error toast and keeps drawer open on load failure', async () => {
      mockListSnapshots.mockResolvedValue(sampleSnapshots);
      mockRestoreSnapshotById.mockResolvedValue(false);

      render(<SnapshotDrawer />);
      const loadBtns = await screen.findAllByTitle('Load this snapshot');

      fireEvent.click(loadBtns[0]);

      await waitFor(() => {
        expect(mockPushToast).toHaveBeenCalledWith("Couldn't load that snapshot.");
      });
      expect(useUiStore.getState().snapshotsOpen).toBe(true);
    });
  });

  // --- Suite 5: Snapshot Comparison (Compare) ---
  describe('Snapshot Comparison (Compare)', () => {
    it('executes graph diff, sets overlay, frames camera, and closes drawer', async () => {
      mockListSnapshots.mockResolvedValue(sampleSnapshots);
      mockLoadSnapshot.mockResolvedValue({
        id: 101,
        name: 'Baseline Graph',
        savedAt: 1770000000000,
        corpusHash: 'hash-123',
        docHashes: ['doc-1'],
        positions: {},
        exportData: {
          version: 1,
          createdAt: '2026-08-13T10:00:00.000Z',
          generator: 'knowledge-nebula',
          includeEmbeddings: false,
          nodes: [
            {
              id: 'doc-1',
              kind: 'document',
              title: 'Document 1',
              fileType: 'md',
              topics: [],
              entities: [],
              keywords: [],
              wordCount: 100,
              cluster: 0,
              degree: 1,
              status: 'ok',
            },
          ],
          edges: [],
        },
      });

      mockDiffGraphs.mockReturnValue({
        docsBefore: 1,
        docsAfter: 2,
        addedDocs: 1,
        removedDocs: 0,
        updatedDocs: 0,
        addedEdges: 0,
        removedEdges: 0,
        addedIds: ['doc-2'],
        updatedIds: [],
        removedLabels: [],
      });
      mockFormatDiffSummary.mockReturnValue('+1 doc');

      render(<SnapshotDrawer />);
      const compareBtns = await screen.findAllByTitle(
        'Highlight what changed between this snapshot and the current graph',
      );

      fireEvent.click(compareBtns[0]);

      await waitFor(() => {
        expect(mockLoadSnapshot).toHaveBeenCalledWith(101);
      });
      expect(mockSetSnapshotOverlay).toHaveBeenCalledWith({
        summary: '+1 doc',
        addedIds: ['doc-2'],
        updatedIds: [],
        removedLabels: [],
      });
      expect(mockSetSearchResults).toHaveBeenCalledWith(['doc-2'], 'snapshot');
      expect(mockSendCamera).toHaveBeenCalledWith('frameSet', ['doc-2']);
      expect(useUiStore.getState().snapshotsOpen).toBe(false);
    });

    it('shows toast when comparison data is missing', async () => {
      mockListSnapshots.mockResolvedValue(sampleSnapshots);
      mockLoadSnapshot.mockResolvedValue(undefined);

      render(<SnapshotDrawer />);
      const compareBtns = await screen.findAllByTitle(
        'Highlight what changed between this snapshot and the current graph',
      );

      fireEvent.click(compareBtns[0]);

      await waitFor(() => {
        expect(mockPushToast).toHaveBeenCalledWith(
          "Couldn't read that snapshot for comparison.",
        );
      });
    });
  });

  // --- Suite 6: Snapshot Deletion (Delete & Inline Confirm) ---
  describe('Snapshot Deletion', () => {
    it('requires two-step inline confirmation before deleting', async () => {
      mockListSnapshots.mockResolvedValue([sampleSnapshots[0]]);
      mockDeleteSnapshot.mockResolvedValue(true);

      render(<SnapshotDrawer />);
      const deleteBtn = await screen.findByRole('button', { name: 'Delete snapshot Baseline Graph' });

      // Step 1: Click delete icon -> presents Confirm and Cancel buttons
      fireEvent.click(deleteBtn);
      expect(screen.getByTitle('Permanently delete this snapshot')).toBeInTheDocument();
      expect(screen.getByTitle('Keep this snapshot')).toBeInTheDocument();
      expect(mockDeleteSnapshot).not.toHaveBeenCalled();

      // Step 2: Click Cancel -> reverts to delete icon
      fireEvent.click(screen.getByTitle('Keep this snapshot'));
      expect(screen.getByRole('button', { name: 'Delete snapshot Baseline Graph' })).toBeInTheDocument();

      // Step 3: Click delete again, then click Confirm
      fireEvent.click(screen.getByRole('button', { name: 'Delete snapshot Baseline Graph' }));
      fireEvent.click(screen.getByTitle('Permanently delete this snapshot'));

      await waitFor(() => {
        expect(mockDeleteSnapshot).toHaveBeenCalledWith(101);
      });
      expect(mockListSnapshots).toHaveBeenCalledTimes(2);
    });
  });
});
