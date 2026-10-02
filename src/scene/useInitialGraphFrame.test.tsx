// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { useUiStore } from '../store/uiStore';
import { focusNode } from '../ui/focusNode';
import { useInitialGraphFrame } from './useInitialGraphFrame';
const events = vi.hoisted(() => ({ settled: undefined as (() => void) | undefined }));
vi.mock('../layout/layoutBridge', () => ({ onLayoutSettled: (fn: () => void) => { events.settled = fn; return () => { events.settled = undefined; }; } }));
vi.mock('./ingestGesture', () => ({ clearIngestBirthSteer: vi.fn(), isIngestFraming: () => false, wasIngestBirthSteered: () => false }));
beforeEach(() => {
  useUiStore.setState({ cameraCommand: null, selectedId: null, pendingFocus: null });
  useGraphStore.setState({ phase: 'ready' });
});
afterEach(cleanup);
it('does not replace a search focus when an imported graph settles late', () => {
  renderHook(() => useInitialGraphFrame(true));
  act(() => focusNode('unicode-document', { text: '東京 計画' }));
  const command = useUiStore.getState().cameraCommand;
  act(() => events.settled?.());
  expect(useUiStore.getState().cameraCommand).toBe(command);
  expect(useUiStore.getState().pendingFocus?.id).toBe('unicode-document');
});
it('continues fitting its own forming graph but stops after an explicit camera command', () => {
  useGraphStore.setState({ phase: 'parsing' });
  renderHook(() => useInitialGraphFrame(true));
  act(() => events.settled?.());
  const first = useUiStore.getState().cameraCommand!;
  act(() => events.settled?.());
  expect(useUiStore.getState().cameraCommand!.nonce).toBe(first.nonce + 1);
  act(() => useUiStore.getState().sendCamera('frameSet', ['picked']));
  const picked = useUiStore.getState().cameraCommand;
  act(() => events.settled?.());
  expect(useUiStore.getState().cameraCommand).toBe(picked);
});
it('resets initial framing for the next empty-to-populated collection', () => {
  const { rerender } = renderHook(({ populated }) => useInitialGraphFrame(populated), { initialProps: { populated: true } });
  act(() => events.settled?.());
  const first = useUiStore.getState().cameraCommand!;
  act(() => events.settled?.());
  expect(useUiStore.getState().cameraCommand).toBe(first);
  rerender({ populated: false });
  rerender({ populated: true });
  act(() => events.settled?.());
  expect(useUiStore.getState().cameraCommand!.nonce).toBe(first.nonce + 1);
});
