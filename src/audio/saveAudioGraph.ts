import { useCorpusStore } from '../store/corpusStore';
import { useGraphStore } from '../store/graphStore';
import { saveActiveCorpusPositions } from '../persistence/corpusRepository';
import { toGraphExport } from '../persistence/graphExport';
import { collectPositions } from '../persistence/sessionSave';

/** Require an acknowledged corpus write before telling the user their edit is saved. */
export async function saveAudioGraph(): Promise<string> {
  if (useCorpusStore.getState().mode !== 'local') {
    return 'Relationship updated. Export this graph to keep your changes.';
  }
  const state = useGraphStore.getState();
  if (state.phase !== 'ready' || !state.corpusHash) {
    throw new Error('Wait for file processing to finish, then try saving again.');
  }
  // The repository captures the active corpus before its first await.
  await saveActiveCorpusPositions(state.corpusHash, toGraphExport(false), collectPositions(state.nodes));
  return 'Relationships saved on this device.';
}
