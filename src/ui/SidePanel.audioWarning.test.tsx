// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DocNode } from '../model/types';

vi.mock('../pipeline/coordinator', () => ({ removeDocuments: vi.fn() }));

import SidePanel from './SidePanel';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';

const clip: DocNode = {
  id: 'clip1', kind: 'document', title: 'Broken', fileType: 'audio',
  topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0,
  status: 'ok', warning: 'This audio could not be decoded for music analysis.',
};

describe('SidePanel audio warning', () => {
  afterEach(() => cleanup());

  // Music analysis failures set only `warning` and leave status ok; the inline
  // inspector must still tell the user the file could not be analysed.
  it('shows a music-analysis warning on an audio clip whose status is ok', () => {
    useGraphStore.setState({ nodes: [clip], nodeIndex: { clip1: 0 }, edges: [], clusterNames: {}, localClusterNames: {} });
    useUiStore.getState().setSelected('clip1');
    render(<SidePanel inline />);
    expect(screen.getByText(/could not be decoded for music analysis/)).toBeInTheDocument();
  });
});
