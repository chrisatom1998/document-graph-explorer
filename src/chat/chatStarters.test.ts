import { describe, expect, it } from 'vitest';
import { corpusChatStarters } from './chatStarters';

describe('corpusChatStarters', () => {
  it('falls back to generic starters when the graph has no special context', () => {
    const starters = corpusChatStarters({ orphanCount: 0 });
    expect(starters.map((s) => s.label)).toEqual([
      'Compare documents',
      'Find contradictions',
      'Build a timeline',
      'Decisions & actions',
    ]);
  });

  it('leads with orphan, cluster, and path starters from live graph state', () => {
    const starters = corpusChatStarters({
      orphanCount: 4,
      largestClusterName: 'Billing',
      pathTitles: ['Spec', 'Runbook'],
    });
    expect(starters[0].label).toBe('Why are these 4 orphans isolated?');
    expect(starters[0].prompt).toContain('4 orphaned documents');
    expect(starters[1].label).toBe('Summarize Billing');
    expect(starters[1].prompt).toContain('Billing');
    expect(starters[2].label).toBe('Explain this path');
    expect(starters[2].prompt).toContain('Spec');
    expect(starters[2].prompt).toContain('Runbook');
    expect(starters).toHaveLength(4);
  });
});
