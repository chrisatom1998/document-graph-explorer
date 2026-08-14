import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../store/uiStore';
import { openInsights } from './openInsights';

describe('openInsights', () => {
  afterEach(() => {
    useUiStore.setState({
      insightsOpen: false,
      insightsFocus: null,
      searchResults: null,
      highlightOwner: null,
    });
  });

  it('opens the drawer and paints a section onto the shared highlight', () => {
    openInsights('orphans', ['a', 'b']);
    const ui = useUiStore.getState();
    expect(ui.insightsOpen).toBe(true);
    expect(ui.insightsFocus).toBe('orphans');
    expect(ui.searchResults).toEqual(['a', 'b']);
    expect(ui.highlightOwner).toBe('insights');
  });

  it('opens without a highlight when no ids are given', () => {
    useUiStore.getState().setSearchResults(['stale'], 'search');
    openInsights();
    const ui = useUiStore.getState();
    expect(ui.insightsOpen).toBe(true);
    expect(ui.insightsFocus).toBeNull();
    expect(ui.searchResults).toBeNull();
  });
});
