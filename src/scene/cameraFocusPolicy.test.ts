import { beforeEach, describe, expect, it } from 'vitest';
import { commitPendingFocusIf, focusNode } from '../ui/focusNode';
import { useUiStore } from '../store/uiStore';
import {
  ARRIVE_EPS_SQ,
  decideFrameNode,
  dismissGraphFocus,
  isAlreadyNear,
  shouldCommitOnTweenCancel,
  shouldDismissGraphFocus,
} from './cameraFocusPolicy';

describe('decideFrameNode', () => {
  it('commits immediately when the node has no layout slot', () => {
    expect(
      decideFrameNode({ hasSlot: false, reducedMotion: false, alreadyNear: false }),
    ).toEqual({ action: 'commit', reason: 'no-slot' });
  });

  it('commits immediately under reduced motion (no tween)', () => {
    expect(
      decideFrameNode({ hasSlot: true, reducedMotion: true, alreadyNear: false }),
    ).toEqual({ action: 'commit', reason: 'reduced-motion' });
  });

  it('commits immediately when the camera is already on target', () => {
    expect(
      decideFrameNode({ hasSlot: true, reducedMotion: false, alreadyNear: true }),
    ).toEqual({ action: 'commit', reason: 'already-near' });
  });

  it('starts a tween when the node is framed at a distance', () => {
    expect(
      decideFrameNode({ hasSlot: true, reducedMotion: false, alreadyNear: false }),
    ).toEqual({ action: 'tween' });
  });

  it('prefers no-slot over reduced-motion or already-near', () => {
    expect(
      decideFrameNode({ hasSlot: false, reducedMotion: true, alreadyNear: true }),
    ).toEqual({ action: 'commit', reason: 'no-slot' });
  });
});

describe('arrival and cancel', () => {
  it('treats both camera and target within ARRIVE_EPS_SQ as arrived', () => {
    expect(isAlreadyNear(0, 0)).toBe(true);
    expect(isAlreadyNear(ARRIVE_EPS_SQ - 1e-6, ARRIVE_EPS_SQ - 1e-6)).toBe(true);
    expect(isAlreadyNear(ARRIVE_EPS_SQ, 0)).toBe(false);
    expect(isAlreadyNear(0, ARRIVE_EPS_SQ)).toBe(false);
  });

  it('commits the pending focus when a user gesture cancels an active tween', () => {
    expect(shouldCommitOnTweenCancel(true)).toBe(true);
    expect(shouldCommitOnTweenCancel(false)).toBe(false);
  });
});

describe('empty-space dismiss vs late camera arrival', () => {
  beforeEach(() => {
    useUiStore.setState({
      selectedId: null,
      pendingFocus: null,
      readerHighlight: null,
      cameraCommand: null,
    });
  });

  it('clears an in-flight focus so a late commit cannot reopen the panel', () => {
    focusNode('doc-a');
    expect(shouldDismissGraphFocus(null, useUiStore.getState().pendingFocus)).toBe(true);

    dismissGraphFocus();
    expect(useUiStore.getState().pendingFocus).toBeNull();
    expect(useUiStore.getState().selectedId).toBeNull();
    expect(commitPendingFocusIf('doc-a')).toBe(false);
    expect(useUiStore.getState().selectedId).toBeNull();
  });

  it('ignores a late commit for a superseded pending focus', () => {
    focusNode('doc-a');
    focusNode('doc-b');
    expect(commitPendingFocusIf('doc-a')).toBe(false);
    expect(useUiStore.getState().pendingFocus).toEqual({ id: 'doc-b' });
    expect(useUiStore.getState().selectedId).toBeNull();
  });

  it('dismisses an already-open panel', () => {
    useUiStore.getState().setSelected('doc-a');
    expect(shouldDismissGraphFocus('doc-a', null)).toBe(true);
    dismissGraphFocus();
    expect(useUiStore.getState().selectedId).toBeNull();
  });
});
