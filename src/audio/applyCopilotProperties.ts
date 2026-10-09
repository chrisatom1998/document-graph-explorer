import type { DocNode } from '../model/types';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { markDocsDirty } from '../store/runtimeStores';
import { enqueueRun } from '../pipeline/runQueue';
import { saveSession } from '../persistence/sessionSave';
import { saveAudioGraph } from './saveAudioGraph';
import { copilotEvidence, type CopilotSample } from './copilotEvidence';
import { parseCopilotSuggestions, sanitizeCopilotProperties, type CopilotSuggestion } from './copilotProperties';
import type { ListeningCoverage } from './copilotListening';

export function copilotCorpusIdentity(): string {
  const corpus = useCorpusStore.getState();
  return JSON.stringify([corpus.activeCorpusId, corpus.mode, useGraphStore.getState().corpusHash]);
}

/** Uses the same queue as ingest, reanalysis and corpus switching. */
export function applyCopilotProperties(input: {
  ids: string[]; evidence: CopilotSample[]; suggestions: CopilotSuggestion[]; model: string; corpus: string; listening?: ListeningCoverage[];
}): Promise<string> {
  return enqueueRun(async () => {
    const state = useGraphStore.getState();
    if (state.phase !== 'ready' || useCorpusStore.getState().switching || input.corpus !== copilotCorpusIdentity()) throw Error('The library changed. Run a new review before adding properties.');
    if (!input.ids.length || input.ids.length !== input.evidence.length || new Set(input.ids).size !== input.ids.length) throw Error('Invalid review selection.');
    const nodes = input.ids.map(id => state.nodes.find(n => n.id === id));
    if (nodes.some((node, i) => !node || JSON.stringify(copilotEvidence(node, i)) !== JSON.stringify(input.evidence[i]))) throw Error('The sound evidence changed. Run a new review before adding properties.');
    const suggestions = parseCopilotSuggestions(input.suggestions, input.evidence);
    const patches = new Map<string, Partial<DocNode>>();
    for (const suggestion of suggestions) {
      const index = input.evidence.findIndex(sample => sample.ref === suggestion.ref);
      const node = nodes[index]!;
      const excerpt = input.listening?.find(clip => clip.ref === suggestion.ref);
      const properties = sanitizeCopilotProperties({ tags: suggestion.tags, model: input.model,
        ...(excerpt ? { audioExcerpt: { startSeconds: excerpt.startSeconds, durationSeconds: excerpt.durationSeconds } } : {}) });
      if (!properties || !node.audio) throw Error('Invalid suggested properties.');
      patches.set(node.id, { audio: { ...node.audio, copilotProperties: properties } });
    }
    if (!patches.size) return 'No new properties to add. Your confirmed labels are unchanged.';
    state.patchNodes(patches);
    markDocsDirty(patches.keys());
    try {
      await saveSession();
      // Unlike best-effort cache writes, this requires a repository acknowledgement.
      await saveAudioGraph();
    } catch { throw Error('Properties were added in this tab, but saving failed. Keep this tab open and click Apply suggested properties to retry.'); }
    return useCorpusStore.getState().mode === 'local'
      ? `AI-suggested properties saved for ${patches.size} sound${patches.size === 1 ? '' : 's'}. Your confirmed labels are unchanged.`
      : 'AI-suggested properties added. Export this graph to keep your changes. Your confirmed labels are unchanged.';
  });
}
