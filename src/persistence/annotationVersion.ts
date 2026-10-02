/** Annotation clocks are epoch milliseconds plus small logical increments.
 * Peers get one day of clock skew; stored/local clocks get another day of
 * logical headroom (86.4 million edits without wall-clock advancement).
 * Invalid legacy clocks lose ordering authority, but their note content stays.
 */
export const ANNOTATION_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
export function validAnnotationVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
    value <= Date.now() + 2 * ANNOTATION_CLOCK_SKEW_MS;
}
export function validPeerAnnotationVersion(value: unknown): value is number {
  return validAnnotationVersion(value) && value <= Date.now() + ANNOTATION_CLOCK_SKEW_MS;
}
export function annotationVersion(value: unknown): number {
  return validAnnotationVersion(value) ? value : 0;
}
