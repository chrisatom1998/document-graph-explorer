import type { LunaSample } from './lunaEvidence';
export const sample: LunaSample = { ref: 'Sample 1', durationSeconds: 10, locked: { source: false, production: false, character: false },
  protectedLabels: { source: [], production: [], character: [] }, truncated: false,
  labels: [{ id: 'e1', group: 'source', originalLabel: 'Vocals', sourceModel: 'detector-a', score: .7, supported: true, ambiguous: false, coverage: [{ start: 0, end: 4 }] },
    { id: 'e2', group: 'source', originalLabel: 'unclear keys', sourceModel: 'detector-b', score: .45, supported: false, ambiguous: true, coverage: null }] };
