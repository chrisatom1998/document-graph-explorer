import { describe, expect, it } from 'vitest';
import {
  ANALYZE_MENU_ACTIONS,
  AUDIO_WORKSPACE_TABS,
  CAPABILITIES,
  CORE_LOOP,
  DEFAULT_TOOLBAR_ACTIONS,
  DOCUMENT_WORKSPACE_TABS,
  SAMPLE_LOOP,
  capabilitiesOnLayer,
  workspaceTabs,
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
    expect(DEFAULT_TOOLBAR_ACTIONS).not.toContain('compare');
    expect(ANALYZE_MENU_ACTIONS).not.toContain('compare');
  });

  it('keeps document compare as a core overlay of read', () => {
    const byId = Object.fromEntries(CAPABILITIES.map((capability) => [capability.id, capability]));
    expect(byId.compare?.layer).toBe('core');
    expect(byId.compare?.chrome).toBe('overlay');
  });

  it('opens an audio library on For you and leaves documents on the graph', () => {
    expect([...SAMPLE_LOOP]).toEqual(['ingest', 'listen', 'similar', 'sound-map', 'persist']);
    expect([...AUDIO_WORKSPACE_TABS]).toEqual(['foryou', 'graph', 'library', 'export']);
    expect([...DOCUMENT_WORKSPACE_TABS]).toEqual(['graph', 'library', 'export']);
    expect([...workspaceTabs(true)]).toEqual([...AUDIO_WORKSPACE_TABS]);
    expect([...workspaceTabs(false)]).toEqual([...DOCUMENT_WORKSPACE_TABS]);
    const byId = Object.fromEntries(CAPABILITIES.map((capability) => [capability.id, capability]));
    expect(byId['audio-home']?.layer).toBe('core');
    expect(byId['similar-sounds']?.layer).toBe('core');
    expect(AUDIO_WORKSPACE_TABS).not.toContain('sample-assistant');
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
