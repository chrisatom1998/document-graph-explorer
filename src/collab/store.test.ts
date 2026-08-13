import { describe, expect, it } from 'vitest';
import { sanitizeSharedFilter } from './store';

describe('sanitizeSharedFilter', () => {
  it('copies only validated graph filter fields from shared state', () => {
    const remote = JSON.parse(
      '{"__proto__":{"polluted":true},"fileTypes":["md","pdf"],"clusters":[1,2],"minDegree":3,"minEdgeWeight":0.4,"edgeKinds":["semantic"],"modifiedWithinDays":30}',
    ) as unknown;

    expect(sanitizeSharedFilter(remote)).toEqual({
      fileTypes: ['md', 'pdf'],
      clusters: [1, 2],
      minDegree: 3,
      minEdgeWeight: 0.4,
      edgeKinds: ['semantic'],
      modifiedWithinDays: 30,
    });
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('omits malformed remote values instead of merging them into UI state', () => {
    expect(sanitizeSharedFilter({
      fileTypes: ['exe'],
      clusters: [1, 2.5],
      minDegree: -1,
      minEdgeWeight: 2,
      edgeKinds: ['unknown'],
      modifiedWithinDays: Number.NaN,
    })).toBeUndefined();
  });
});
