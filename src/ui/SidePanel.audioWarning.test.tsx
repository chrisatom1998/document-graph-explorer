// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));
vi.mock('../persistence/originals', () => ({ getOriginal: vi.fn(async () => undefined) }));

import { PENDING_MUSIC_ANALYSIS_WARNING } from '../audio/parseAudio';
import SidePanel from './SidePanel';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const clip: DocNode = {
  id: 'clip1', kind: 'document', title: 'Broken', fileType: 'audio',
  topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0,
  status: 'ok', warning: 'This audio could not be decoded for music analysis.',
};

function select(node: DocNode) {
  useGraphStore.setState({ nodes: [node], nodeIndex: { clip1: 0 }, edges: [], clusterNames: {}, localClusterNames: {} });
  useUiStore.getState().setSelected('clip1');
}

describe('SidePanel audio warning', () => {
  afterEach(() => { cleanup(); useUiStore.getState().setSelected(null); useGraphStore.getState().reset(); });

  it.each([true, false])('shows exactly one complete decode warning with inline=%s and clears it on recovery', async (inline) => {
    select(clip);
    render(<SidePanel inline={inline} />);
    await screen.findByText(/Audio is not saved here/);
    expect(screen.getAllByText(/could not be decoded for music analysis/)).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(clip.warning!);
    expect(document.querySelector('.side-panel__badge-warning')).toBeNull();
    act(() => select({ ...clip, warning: undefined }));
    expect(screen.queryByText(/could not be decoded for music analysis/)).not.toBeInTheDocument();
  });

  it('keeps pending analysis visible as neutral status, without a failure chip', async () => {
    select({ ...clip, warning: PENDING_MUSIC_ANALYSIS_WARNING });
    render(<SidePanel inline />);
    await screen.findByText(/Audio is not saved here/);
    expect(screen.getAllByText(/Music analysis is pending/)).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(PENDING_MUSIC_ANALYSIS_WARNING);
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
    expect(document.querySelector('.side-panel__badge-warning')).toBeNull();
  });

  it('does not repeat a warning when parsing also reports an error status', async () => {
    select({ ...clip, status: 'unreadable' });
    render(<SidePanel inline />);
    await screen.findByText(/Audio is not saved here/);
    expect(screen.getAllByText(/could not be decoded for music analysis/)).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(clip.warning!);
  });

  it('retains a bare error status when no warning detail is available', () => {
    select({ ...clip, status: 'unreadable', warning: undefined });
    render(<SidePanel inline />);
    expect(screen.getByText('⚠ unreadable')).toBeInTheDocument();
  });
});
