import { create } from 'zustand';

export type ResonanceTab = 'foryou' | 'graph' | 'library' | 'export';

const KEY = 'resonance-tab';
const TABS: readonly ResonanceTab[] = ['foryou', 'graph', 'library', 'export'];

/** The last view a person chose; a fresh profile opens on For you. Library and Export need a graph, so they are not restored. */
function initialTab(): ResonanceTab {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'graph' || saved === 'foryou') return saved;
  } catch { /* storage unavailable: use the default */ }
  return 'foryou';
}

interface ViewState {
  tab: ResonanceTab;
  setTab: (tab: ResonanceTab) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  tab: initialTab(),
  setTab: (tab) => {
    if (!TABS.includes(tab)) return;
    try { if (tab === 'graph' || tab === 'foryou') localStorage.setItem(KEY, tab); } catch { /* not persisted */ }
    set({ tab });
  },
}));
