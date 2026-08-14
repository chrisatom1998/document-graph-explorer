/**
 * Minimal collaboration primitives for the browser-only graph app.
 *
 * Privacy model: view + presence can leave the browser over the room.
 * Notes/tags leave only when the user opts in (default off). Corpus text/bytes
 * and local filesystem paths stay local. Public STUN is disabled (host ICE
 * only); NAT traversal may fail without it.
 */

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { AIRGAP, AIRGAP_MESSAGE } from '../airgap';
import { isOffline } from '../offline';
import type { DocAnnotationRecord } from '../persistence/db';
import { sanitizeAnnotationMap } from '../store/annotationSanitize';

export const COLLAB_FRAGMENT_PREFIX = '#collab=v1.';
export const DEFAULT_COLLAB_SIGNALING = ['wss://signaling.yjs.dev'];
export const COLLAB_OFFLINE_MESSAGE =
  'Offline mode is on — collaboration is disabled (no external network).';

/**
 * y-webrtc / simple-peer default to Google + Twilio STUN when `iceServers` is
 * unset. We pass an empty list so collab never contacts those hosts. Peers on
 * the same LAN can still connect via host ICE; NAT traversal may fail.
 */
export const COLLAB_ICE_SERVERS: RTCIceServer[] = [];
export const COLLAB_PEER_OPTS = { config: { iceServers: COLLAB_ICE_SERVERS } };

export interface CollabSessionConfig {
  roomId: string;
  sessionKey: string;
  signaling?: string[];
}

export interface CollabSession {
  doc: Y.Doc;
  provider: WebrtcProvider | null;
  view: Y.Map<any>;
  annotations: Y.Map<DocAnnotationRecord>;
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

/**
 * Minimum length for a session key to be worth calling a secret. Generated
 * keys are 32 hex chars (16 random bytes); this only ever fires on a key a
 * user typed in by hand.
 */
const MIN_STRONG_KEY_CHARS = 16;

/**
 * True when a session key is guessable enough to be worth warning about.
 * Deliberately not enforced in sanitizeCollabToken: the key is the room's only
 * access control, but rejecting short ones would break invites already in
 * circulation and hand-made room names peers agreed on out of band. Callers
 * warn and proceed.
 */
export function isWeakCollabKey(key: string): boolean {
  const safe = sanitizeCollabToken(key);
  if (safe.length < MIN_STRONG_KEY_CHARS) return true;
  // A long key drawn from one character class (all digits, all one case) has
  // far less entropy than its length suggests.
  return /^[0-9]+$/.test(safe) || /^[a-z]+$/.test(safe) || /^[A-Z]+$/.test(safe);
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
  if (isOffline()) {
    throw new Error(COLLAB_OFFLINE_MESSAGE);
  }
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
    peerOpts: COLLAB_PEER_OPTS,
  });
  const view = doc.getMap<any>('view');
  const annotations = createAnnotationMap(doc);
  provider.awareness.setLocalState({ displayName: 'Local user', cursor: null });

  return {
    doc,
    provider,
    view,
    annotations,
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
  for (const [key, value] of Object.entries(sanitizeAnnotationMap(annotations, Date.now()))) {
    map.set(key, value);
  }
}

export function snapshotAnnotationMap(map: Y.Map<DocAnnotationRecord>): Record<string, DocAnnotationRecord> {
  // Every value here was authored by a peer, so it is bounded on the way out
  // of the shared doc as well as on the way in.
  return sanitizeAnnotationMap(Object.fromEntries(map.entries()));
}
