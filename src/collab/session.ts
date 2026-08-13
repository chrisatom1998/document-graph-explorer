/**
 * Minimal collaboration primitives for the browser-only graph app.
 *
 * The privacy model is intentionally narrow: annotations and presence can leave
 * the browser, while the corpus itself stays local to each peer.
 */

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { AIRGAP, AIRGAP_MESSAGE } from '../airgap';
import type { DocAnnotationRecord } from '../persistence/db';

export const COLLAB_FRAGMENT_PREFIX = '#collab=v1.';
export const DEFAULT_COLLAB_SIGNALING = ['wss://signaling.yjs.dev'];

export interface CollabSessionConfig {
  roomId: string;
  sessionKey: string;
  signaling?: string[];
}

export interface CollabSession {
  doc: Y.Doc;
  provider: WebrtcProvider | null;
  roomId: string;
  sessionKey: string;
  signaling: string[];
}

export function requireCollabEnabled(): void {
  if (AIRGAP) {
    throw new Error(AIRGAP_MESSAGE);
  }
}

export function sanitizeCollabToken(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '')
    .slice(0, 64);
}

export function buildCollabInvite(roomId: string, sessionKey: string): string {
  const safeRoom = sanitizeCollabToken(roomId);
  const safeKey = sanitizeCollabToken(sessionKey);
  if (!safeRoom || !safeKey) {
    throw new Error('Both roomId and sessionKey are required to build a collaboration invite.');
  }
  requireCollabEnabled();
  return `${COLLAB_FRAGMENT_PREFIX}${encodeURIComponent(safeRoom)}.${encodeURIComponent(safeKey)}`;
}

export function parseCollabInvite(value: string): CollabSessionConfig | null {
  if (!value) return null;
  const source = typeof value === 'string' ? value : String(value);
  const hash = source.includes('#') ? source.slice(source.indexOf('#')) : source;
  const raw = hash.startsWith(COLLAB_FRAGMENT_PREFIX)
    ? hash.slice(COLLAB_FRAGMENT_PREFIX.length)
    : null;
  if (!raw) return null;

  const sep = raw.indexOf('.');
  if (sep <= 0 || sep === raw.length - 1) return null;

  try {
    const roomId = sanitizeCollabToken(decodeURIComponent(raw.slice(0, sep)));
    const sessionKey = sanitizeCollabToken(decodeURIComponent(raw.slice(sep + 1)));
    if (!roomId || !sessionKey) return null;
    return { roomId, sessionKey };
  } catch {
    return null;
  }
}

export function createCollabSession(config: CollabSessionConfig): CollabSession {
  requireCollabEnabled();
  const roomId = sanitizeCollabToken(config.roomId);
  const sessionKey = sanitizeCollabToken(config.sessionKey);
  if (!roomId || !sessionKey) {
    throw new Error('A collaboration room needs both a roomId and sessionKey.');
  }

  const doc = new Y.Doc();
  const signaling = config.signaling && config.signaling.length > 0 ? config.signaling : DEFAULT_COLLAB_SIGNALING;
  const provider = new WebrtcProvider(roomId, doc, {
    signaling,
    password: sessionKey,
  });
  provider.awareness.setLocalState({ displayName: 'Local user', cursor: null });

  return {
    doc,
    provider,
    roomId,
    sessionKey,
    signaling,
  };
}

export function destroyCollabSession(session: CollabSession): void {
  session.provider?.destroy();
  session.doc.destroy();
}

export function createAnnotationMap(doc: Y.Doc): Y.Map<DocAnnotationRecord> {
  return doc.getMap<DocAnnotationRecord>('annotations');
}

export function hydrateAnnotationMap(
  map: Y.Map<DocAnnotationRecord>,
  annotations: Record<string, DocAnnotationRecord>,
): void {
  map.clear();
  for (const [key, value] of Object.entries(annotations ?? {})) {
    map.set(key, {
      note: typeof value.note === 'string' ? value.note : '',
      tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      pinned: value.pinned === true,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    });
  }
}

export function snapshotAnnotationMap(map: Y.Map<DocAnnotationRecord>): Record<string, DocAnnotationRecord> {
  const next: Record<string, DocAnnotationRecord> = {};
  for (const [key, value] of map.entries()) {
    next[key] = {
      note: typeof value.note === 'string' ? value.note : '',
      tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      pinned: value.pinned === true,
      updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    };
  }
  return next;
}
