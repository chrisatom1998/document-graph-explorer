import { create } from 'zustand';

export type CorpusMode = 'local' | 'shared' | 'imported';

export interface CorpusSummary {
  id: string;
  name: string;
  updatedAt: number;
  documentCount: number;
  watching: boolean;
}

interface CorpusState {
  initialized: boolean;
  switching: boolean;
  activeCorpusId: string | null;
  activeName: string;
  mode: CorpusMode;
  corpora: CorpusSummary[];
  setInitialized: (initialized: boolean) => void;
  setSwitching: (switching: boolean) => void;
  setLocalState: (corpora: CorpusSummary[], activeCorpusId: string | null) => void;
  setEphemeral: (name: string, mode: Exclude<CorpusMode, 'local'>) => void;
}

export const useCorpusStore = create<CorpusState>((set) => ({
  initialized: false,
  switching: false,
  activeCorpusId: null,
  activeName: 'My corpus',
  mode: 'local',
  corpora: [],
  setInitialized: (initialized) => set({ initialized }),
  setSwitching: (switching) => set({ switching }),
  setLocalState: (corpora, activeCorpusId) => {
    const active = corpora.find((corpus) => corpus.id === activeCorpusId);
    set({
      initialized: true,
      corpora,
      activeCorpusId,
      activeName: active?.name ?? 'My corpus',
      mode: 'local',
    });
  },
  setEphemeral: (activeName, mode) =>
    set({ activeCorpusId: null, activeName, mode, switching: false }),
}));
