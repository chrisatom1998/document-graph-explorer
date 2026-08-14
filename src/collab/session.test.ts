import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('../airgap', () => ({
  AIRGAP: false,
  AIRGAP_MESSAGE: 'AIRGAP_TEST_MSG',
}));

vi.mock('y-webrtc', () => {
  class WebrtcProvider {
    awareness = {
      setLocalState() {},
      on() {},
      getStates() {
        return new Map();
      },
      clientID: 1,
    };
    destroy() {}
    peerOpts: unknown;
    constructor(_room: string, _doc: unknown, opts: { peerOpts?: unknown }) {
      this.peerOpts = opts.peerOpts;
    }
  }
  return { WebrtcProvider };
});

import { useSettingsStore } from '../store/settingsStore';
import {
  COLLAB_FRAGMENT_PREFIX,
  COLLAB_OFFLINE_MESSAGE,
  COLLAB_PEER_OPTS,
  buildCollabInvite,
  createAnnotationMap,
  createCollabSession,
  hydrateAnnotationMap,
  isWeakCollabKey,
  parseCollabInvite,
  sanitizeCollabToken,
  snapshotAnnotationMap,
} from './session';
import { MAX_ANNOTATION_NOTE_CHARS, MAX_ANNOTATION_TAGS } from '../store/annotationSanitize';

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

describe('weak session keys', () => {
  it('flags keys that are short or drawn from a single character class', () => {
    expect(isWeakCollabKey('secret')).toBe(true);
    expect(isWeakCollabKey('1234567890123456789')).toBe(true);
    expect(isWeakCollabKey('abcdefghijklmnopqrs')).toBe(true);
    expect(isWeakCollabKey('ABCDEFGHIJKLMNOPQRS')).toBe(true);
    // Punctuation is stripped before measuring, so it cannot pad a short key.
    expect(isWeakCollabKey('a!!!!!!!!!!!!!!!!!!!!b')).toBe(true);
  });

  it('accepts a generated-strength key', () => {
    expect(isWeakCollabKey('9f3c1a7be04d28f65c0b9e71a4d3f8b2')).toBe(false);
    expect(isWeakCollabKey('Correct-Horse-9-Battery')).toBe(false);
  });
});

describe('annotation sync map', () => {
  it('bounds peer-authored records on the way in and out of the shared doc', () => {
    const doc = new Y.Doc();
    const map = createAnnotationMap(doc);
    hydrateAnnotationMap(map, {
      'doc-1': {
        note: 'x'.repeat(MAX_ANNOTATION_NOTE_CHARS + 100),
        tags: Array.from({ length: MAX_ANNOTATION_TAGS + 5 }, (_, i) => `t${i}`),
        pinned: true,
        updatedAt: 5,
      },
    });

    const snapshot = snapshotAnnotationMap(map);
    expect(snapshot['doc-1']!.note).toHaveLength(MAX_ANNOTATION_NOTE_CHARS);
    expect(snapshot['doc-1']!.tags).toHaveLength(MAX_ANNOTATION_TAGS);
    doc.destroy();
  });

  it('hydrates and snapshots meaningful annotation state without empty husks', () => {
    const doc = new Y.Doc();
    const map = createAnnotationMap(doc);
    hydrateAnnotationMap(map, {
      'doc-1': { note: 'hello', tags: ['alpha', 'beta'], pinned: true, updatedAt: 5 },
      'doc-2': { note: '', tags: [], pinned: false, updatedAt: 6 },
    });

    expect(snapshotAnnotationMap(map)).toEqual({
      'doc-1': { note: 'hello', tags: ['alpha', 'beta'], pinned: true, updatedAt: 5 },
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

  it('disables default public STUN by passing empty iceServers', () => {
    const session = createCollabSession({ roomId: 'room-stun', sessionKey: 'abcd-1234' });
    expect(COLLAB_PEER_OPTS.config.iceServers).toEqual([]);
    const provider = session.provider as { peerOpts?: { config?: { iceServers?: unknown } } } | null;
    expect(provider?.peerOpts?.config?.iceServers).toEqual([]);
    session.provider?.destroy();
    session.doc.destroy();
  });

  it('refuses to create a session while offline mode is on', () => {
    useSettingsStore.getState().setOfflineMode(true);
    try {
      expect(() => createCollabSession({ roomId: 'room-off', sessionKey: 'abcd-1234' })).toThrow(
        COLLAB_OFFLINE_MESSAGE,
      );
      expect(COLLAB_OFFLINE_MESSAGE).not.toMatch(/\bAI\b/i);
    } finally {
      useSettingsStore.getState().setOfflineMode(false);
    }
  });
});
