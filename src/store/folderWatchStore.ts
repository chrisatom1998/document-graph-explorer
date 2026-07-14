import { create } from 'zustand';

export type FolderWatchStatus =
  | 'idle'
  | 'checking'
  | 'watching'
  | 'paused'
  | 'reconnect'
  | 'unsupported'
  | 'error';

interface FolderWatchState {
  status: FolderWatchStatus;
  folderName: string | null;
  lastSyncAt: number | null;
  lastChangeCount: number;
  error: string | null;
  setState: (patch: Partial<Omit<FolderWatchState, 'setState'>>) => void;
}

export const useFolderWatchStore = create<FolderWatchState>((set) => ({
  status: 'idle',
  folderName: null,
  lastSyncAt: null,
  lastChangeCount: 0,
  error: null,
  setState: (patch) => set(patch),
}));
