/**
 * Invite-hash consent copy. Kept free of yjs/y-webrtc so the collab UI chunk
 * can describe what joining shares before the WebRTC session module loads.
 */

export const COLLAB_JOIN_TITLE = 'Join this collaboration session?';

export const COLLAB_JOIN_CONFIRM = 'Join session';
export const COLLAB_JOIN_CANCEL = 'Cancel';

/** What an invite join will share, given the current notes/tags opt-in. */
export function collabJoinDisclosure(shareNotes: boolean): string {
  const notes = shareNotes
    ? 'Notes and tags will also sync with other people in the room.'
    : 'Notes and tags stay on this device unless you opt in after joining (off by default).';
  return [
    'Joining shares your view (selection, camera, filters) and presence (display name and cursor) with other people in the room.',
    notes,
    'Document text, file bytes, and local filesystem paths never leave this browser.',
    'Peer discovery uses signaling.yjs.dev. Direct connections use host ICE only — public STUN is disabled, so peers behind NAT may not connect.',
  ].join(' ');
}

export function hashLooksLikeCollabInvite(hash: string): boolean {
  return hash.startsWith('#collab=');
}
