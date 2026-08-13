// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  COLLAB_JOIN_CANCEL,
  COLLAB_JOIN_CONFIRM,
  COLLAB_JOIN_TITLE,
  collabJoinDisclosure,
} from './joinConsent';
import { useCollabStore } from './store';

const joinInvite = vi.fn().mockResolvedValue('#collab=v1.room1.key1');

import CollabAppBridge from './AppBridge';

describe('CollabAppBridge invite consent', () => {
  const realJoin = useCollabStore.getState().joinInvite;

  beforeEach(() => {
    joinInvite.mockClear();
    joinInvite.mockResolvedValue('#collab=v1.room1.key1');
    useCollabStore.setState({
      joinInvite,
      shareNotes: false,
      session: null,
      followMode: false,
      lastRemoteView: null,
    });
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    useCollabStore.setState({ joinInvite: realJoin, shareNotes: false });
    window.history.replaceState(null, '', '/');
  });

  it('does not auto-join a collab hash; cancel leaves the hash and does not connect', async () => {
    window.history.replaceState(null, '', '/#collab=v1.room1.key1');
    render(<CollabAppBridge />);

    const dialog = await screen.findByRole('dialog', { name: COLLAB_JOIN_TITLE });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveTextContent(/view/i);
    expect(dialog).toHaveTextContent(/presence/i);
    expect(dialog).toHaveTextContent(/notes and tags stay on this device/i);
    expect(joinInvite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: COLLAB_JOIN_CANCEL }));

    expect(joinInvite).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: COLLAB_JOIN_TITLE })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#collab=v1.room1.key1');
  });

  it('joins only after confirm and then strips the hash', async () => {
    window.history.replaceState(null, '', '/#collab=v1.room1.key1');
    render(<CollabAppBridge />);
    await screen.findByRole('dialog', { name: COLLAB_JOIN_TITLE });

    fireEvent.click(screen.getByRole('button', { name: COLLAB_JOIN_CONFIRM }));

    await waitFor(() => expect(joinInvite).toHaveBeenCalledTimes(1));
    expect(joinInvite).toHaveBeenCalledWith('#collab=v1.room1.key1');
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(screen.queryByRole('dialog', { name: COLLAB_JOIN_TITLE })).not.toBeInTheDocument();
  });

  it('does not connect when there is no collab hash', () => {
    render(<CollabAppBridge />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(joinInvite).not.toHaveBeenCalled();
  });
});

describe('collabJoinDisclosure', () => {
  it('says notes stay local when the opt-in is off', () => {
    expect(collabJoinDisclosure(false)).toMatch(/notes and tags stay on this device/i);
    expect(collabJoinDisclosure(false)).toMatch(/view/i);
    expect(collabJoinDisclosure(false)).toMatch(/presence/i);
  });

  it('says notes sync when the opt-in is on', () => {
    expect(collabJoinDisclosure(true)).toMatch(/notes and tags will also sync/i);
  });
});
