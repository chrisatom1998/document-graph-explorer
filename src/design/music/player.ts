import { create } from 'zustand';
import { useGraphStore } from '../../store/graphStore';
import { useUiStore } from '../../store/uiStore';
import { openFilePicker } from '../../ingest/DropZone';
import { openFolderPicker } from '../../ingest/folderPicker';
import { rememberCenterOrigin } from '../../scene/ingestGesture';

interface PlayerState {
  currentId: string | null;
  playing: boolean;
  /** 0..1 through the current clip. */
  progress: number;
  /** Bumped to ask the audio element to (re)start, pause or seek. */
  command: { kind: 'play' | 'pause' | 'seek'; at?: number; nonce: number } | null;
}

export const usePlayerStore = create<PlayerState>(() => ({ currentId: null, playing: false, progress: 0, command: null }));

let nonce = 0;
const send = (kind: 'play' | 'pause' | 'seek', at?: number) => usePlayerStore.setState({ command: { kind, at, nonce: ++nonce } });

/** Select a clip the way the inspector's Select does: highlight it and frame it in the graph. */
export function selectClip(id: string): void {
  const state = useUiStore.getState();
  state.setSelected(id);
  state.sendCamera('frameNode', [id]);
}

export function playClip(id: string): void {
  const { currentId, playing } = usePlayerStore.getState();
  if (currentId === id) {
    send(playing ? 'pause' : 'play');
    return;
  }
  usePlayerStore.setState({ currentId: id, progress: 0 });
  send('play');
}

export function togglePlayback(): void {
  const { currentId } = usePlayerStore.getState();
  const fallback = currentId ?? useUiStore.getState().selectedId ?? audioClips()[0]?.id;
  if (fallback) playClip(fallback);
}

export function seekTo(fraction: number): void { send('seek', Math.min(1, Math.max(0, fraction))); }

export function audioClips() {
  return useGraphStore.getState().nodes.filter(n => n.kind === 'document' && n.fileType === 'audio');
}

/** Step through the library order from the clip now playing (or selected). */
export function skip(step: 1 | -1): void {
  const clips = audioClips();
  if (!clips.length) return;
  const from = usePlayerStore.getState().currentId ?? useUiStore.getState().selectedId;
  const index = clips.findIndex(c => c.id === from);
  const next = clips[(index + step + clips.length) % clips.length];
  selectClip(next.id);
  playClip(next.id);
}

let demoBusy = false;
/** Same entry points as the welcome card: the generated audio demo or the 100-document demo. */
export function loadDemo(kind: 'audio' | 'docs', onBusy?: (busy: boolean) => void): void {
  if (demoBusy) return;
  demoBusy = true;
  onBusy?.(true);
  rememberCenterOrigin();
  import('../../pipeline/coordinatorLazy')
    .then(mod => (kind === 'docs' ? mod.loadDemoCorpus() : mod.loadDemoAudio()))
    .catch(error => {
      console.warn(kind === 'docs' ? 'demo corpus load failed' : 'audio demo load failed', error);
      useUiStore.getState().pushToast(kind === 'docs' ? "Couldn't load the demo corpus." : "Couldn't load the audio demo.");
    })
    .finally(() => { demoBusy = false; onBusy?.(false); });
}

export const addFiles = openFilePicker;
export const addFolder = openFolderPicker;
export function openSearch(): void { const s = useUiStore.getState(); s.setSearchResults(null); s.setSearchOpen(true); }
export function openSettings(): void { useUiStore.getState().setSettingsOpen(true); }
export function fitGraph(): void { useUiStore.getState().sendCamera('fitAll'); }
