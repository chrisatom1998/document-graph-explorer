import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../airgap', () => ({
  AIRGAP: false,
  AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG',
}));

import {
  COLLAB_FRAGMENT_PREFIX,
  buildCollabInvite,
  createAnnotationMap,
  createCollabSession,
  hydrateAnnotationMap,
  parseCollabInvite,
  sanitizeCollabToken,
  snapshotAnnotationMap,
} from './session';

afterEach(() => {
  vi.clearAllMocks();
});

describe('collaboration invites', () => {
  it('builds and parses a valid room invite', () => {
    const invite = buildCollabInvite('design-team', 'super-secret');
    expect(invite).toBe(`${COLLAB_FRAGMENT_PREFIX}${encodeURIComponent('design-team')}.` + encodeURIComponent('super-secret'));
    expect(parseCollabInvite(invite)).toEqual({
      roomId: 'design-team',
      sessionKey: 'super-secret',
    });
  });

  it('sanitizes malformed room names and keys', () => {
    expect(sanitizeCollabToken('  room/with:bad?chars  ')).toBe('roomwithbadchars');
    expect(parseCollabInvite(`${COLLAB_FRAGMENT_PREFIX}room/with:bad?chars.${'a'.repeat(200)}`)).toEqual({
      roomId: 'roomwithbadchars',
      sessionKey: 'a'.repeat(64),
    });
  });

  it('returns null for unrelated or malformed fragments', () => {
    expect(parseCollabInvite('#settings')).toBeNull();
    expect(parseCollabInvite('#collab=v1.')).toBeNull();
    expect(parseCollabInvite('https://example.test/#graph=v1.abc')).toBeNull();
  });

  it('sanitizes dots out of room and key before encoding the invite', () => {
    const invite = buildCollabInvite('team.alpha', 'secret.key');
    expect(invite).toBe(`${COLLAB_FRAGMENT_PREFIX}teamalpha.secretkey`);
    expect(parseCollabInvite(invite)).toEqual({
      roomId: 'teamalpha',
      sessionKey: 'secretkey',
    });
  });

  it('returns null for invalid encoding or tokens that sanitize empty', () => {
    expect(parseCollabInvite(`${COLLAB_FRAGMENT_PREFIX}%E0%A4%A.key`)).toBeNull();
    expect(parseCollabInvite(`${COLLAB_FRAGMENT_PREFIX}room.%E0%A4%A`)).toBeNull();
    expect(parseCollabInvite(`${COLLAB_FRAGMENT_PREFIX}!!!.@@@`)).toBeNull();
  });
});

describe('annotation sync map', () => {
  it('hydrates and snapshots annotation state', () => {
    const doc = new Y.Doc();
    const map = createAnnotationMap(doc);
    hydrateAnnotationMap(map, {
      'doc-1': { note: 'hello', tags: ['alpha', 'beta'], pinned: true, updatedAt: 5 },
      'doc-2': { note: '', tags: [], pinned: false, updatedAt: 6 },
    });

    expect(snapshotAnnotationMap(map)).toEqual({
      'doc-1': { note: 'hello', tags: ['alpha', 'beta'], pinned: true, updatedAt: 5 },
      'doc-2': { note: '', tags: [], pinned: false, updatedAt: 6 },
    });
    doc.destroy();
  });
});

describe('collab runtime', () => {
  it('creates a session with a room and key', () => {
    const session = createCollabSession({ roomId: 'room-1', sessionKey: 'abcd-1234' });
    expect(session.roomId).toBe('room-1');
    expect(session.sessionKey).toBe('abcd-1234');
    session.provider?.destroy();
    session.doc.destroy();
  });
});
