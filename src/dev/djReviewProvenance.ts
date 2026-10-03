export const HUMAN_REVIEW_PROVENANCE = 'explicit human confirmation' as const;

export interface DjReviewCandidate {
  confirmed: boolean;
  provenance?: unknown;
  labels: { source: string[]; production: string[]; character: string[] };
  knownLabels: string[];
}

/** Reject ambiguous review records before they can reach model construction. */
export function humanTrainingReviews(reviews: Record<string, DjReviewCandidate>): [string, DjReviewCandidate & { confirmed: true; provenance: typeof HUMAN_REVIEW_PROVENANCE }][] {
  const candidates = Object.entries(reviews);
  if (candidates.some(([, review]) => review.confirmed !== true || review.provenance !== HUMAN_REVIEW_PROVENANCE)) {
    throw new Error('Only explicit human confirmations can train the classifier.');
  }
  return candidates as [string, DjReviewCandidate & { confirmed: true; provenance: typeof HUMAN_REVIEW_PROVENANCE }][];
}
