/**
 * Session state for the ingest gesture and camera-framing flags. Dependency-
 * free on purpose: the app entry (App.tsx) and the small ingest chrome
 * (DropZone / folder picker / EmptyState) import THIS module, so the
 * ingest-birth math (origin projection, travel, fit, edge reveal) stays out
 * of the entry chunk (scripts/check-bundle.mjs entry budget). ingestBirth.ts
 * re-exports everything here, so scene/pipeline code keeps one import path.
 */

export type Vec3 = [number, number, number];

export type PendingOrigin =
  | { kind: 'client'; clientX: number; clientY: number }
  | { kind: 'add' }
  | { kind: 'center' }
  | { kind: 'world'; point: Vec3 };

let pending: PendingOrigin | null = null;

let ingestFraming = false;
let ingestUserSteered = false;

// ---------------------------------------------------------------------------
// Origin recording (call at the user gesture; ingestBirth resolves it when
// the ingest run starts)
// ---------------------------------------------------------------------------

export function rememberDropOrigin(clientX: number, clientY: number): void {
  pending = { kind: 'client', clientX, clientY };
}

export function rememberAddOrigin(): void {
  pending = { kind: 'add' };
}

export function rememberCenterOrigin(): void {
  pending = { kind: 'center' };
}

export function rememberWorldOrigin(point: Vec3): void {
  pending = { kind: 'world', point: [point[0], point[1], point[2]] };
}

export function clearPendingOrigin(): void {
  pending = null;
}

/** Current pending gesture origin (read by ingestBirth's resolve path). */
export function pendingIngestOrigin(): PendingOrigin | null {
  return pending;
}

// ---------------------------------------------------------------------------
// Camera: first empty-corpus ingest follows; incremental add never steals
// ---------------------------------------------------------------------------

export type IngestCameraMode = 'follow' | 'snap' | 'leave';

export function decideIngestCamera(input: {
  corpusWasEmpty: boolean;
  userSteered: boolean;
  reducedMotion: boolean;
}): IngestCameraMode {
  if (!input.corpusWasEmpty || input.userSteered) return 'leave';
  return input.reducedMotion ? 'snap' : 'follow';
}

export function beginIngestBirth(input: { corpusWasEmpty: boolean; reducedMotion: boolean }): IngestCameraMode {
  ingestUserSteered = false;
  const mode = decideIngestCamera({
    corpusWasEmpty: input.corpusWasEmpty,
    userSteered: false,
    reducedMotion: input.reducedMotion,
  });
  ingestFraming = mode === 'follow' || mode === 'snap';
  return mode;
}

export function noteIngestCameraSteer(): void {
  ingestUserSteered = true;
  ingestFraming = false;
}

export function endIngestBirth(): { shouldFinalFit: boolean } {
  const shouldFinalFit = ingestFraming && !ingestUserSteered;
  ingestFraming = false;
  return { shouldFinalFit };
}

export function isIngestFraming(): boolean {
  return ingestFraming;
}
