// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../store/uiStore';
import { focusNode } from '../ui/focusNode';
import { WebGLFallback } from './NebulaCanvas';

describe('WebGLFallback', () => {
  beforeEach(() => {
    useUiStore.setState({
      selectedId: null,
      pendingFocus: null,
      readerHighlight: null,
      cameraCommand: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens a focused document when no camera rig is available', async () => {
    render(<WebGLFallback />);
    expect(screen.getByRole('status')).toHaveTextContent('Interactive graph unavailable');

    act(() => focusNode('doc-a'));

    await waitFor(() => expect(useUiStore.getState().selectedId).toBe('doc-a'));
    expect(useUiStore.getState().pendingFocus).toBeNull();
  });
});
