import { describe, expect, it } from 'vitest';
import {
  ANALYZE_MENU_ACTIONS,
  CAPABILITIES,
  CORE_LOOP,
  DEFAULT_TOOLBAR_ACTIONS,
  capabilitiesOnLayer,
} from './surface';

describe('product surface', () => {
  it('keeps the core loop to ingest → graph → read → search → persist', () => {
    expect([...CORE_LOOP]).toEqual(['ingest', 'graph', 'read', 'search', 'persist']);
  });

  it('does not give studio tools their own toolbar slot', () => {
    expect([...DEFAULT_TOOLBAR_ACTIONS]).toEqual([
      'search',
      'fit',
      'view',
      'analyze',
      'data',
      'settings',
      'add',
    ]);
    expect([...ANALYZE_MENU_ACTIONS]).toEqual(['path', 'insights', 'snapshots']);
    expect(DEFAULT_TOOLBAR_ACTIONS).not.toContain('path');
    expect(DEFAULT_TOOLBAR_ACTIONS).not.toContain('insights');
    expect(DEFAULT_TOOLBAR_ACTIONS).not.toContain('snapshots');
  });

  it('classifies OpenUSD, airgap, and desktop as satellites', () => {
    const byId = Object.fromEntries(CAPABILITIES.map((capability) => [capability.id, capability]));
    expect(byId['export-usd']?.layer).toBe('interop');
    expect(byId['export-usd']?.chrome).toBe('menu');
    expect(byId.airgap?.layer).toBe('packaging');
    expect(byId.desktop?.layer).toBe('packaging');
    expect(byId['usd-agent']?.layer).toBe('packaging');
    expect(capabilitiesOnLayer('core').every((capability) => capability.chrome !== 'packaging')).toBe(
      true,
    );
  });
});
