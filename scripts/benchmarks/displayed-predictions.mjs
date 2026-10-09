import { confidentSoundSummary, SOUND_DISPLAY_POLICY } from '../../src/audio/confidentSoundSummary';
export { SOUND_DISPLAY_POLICY };

export function displayedPredictions(manifest, graph, tier = 'all') {
  const byName = new Map();
  for (const node of graph.nodes ?? []) {
    const name = node.path ?? node.title;
    if (byName.has(name)) throw new Error(`Ambiguous graph filename: ${name}`);
    byName.set(name, node);
  }
  return manifest.clips.map(c => {
    const node = byName.get(c.file), audio = node?.audio;
    if (audio?.confirmedInstruments?.length || audio?.confirmedDjTags || audio?.soundReviews?.length || audio?.copilotProperties) {
      throw new Error(`Corrected/assisted audio cannot be used as a blind prediction: ${c.id}`);
    }
    const shown = audio ? confidentSoundSummary(audio, audio.recognition?.mode) : [];
    return { id: c.id, status: audio?.stage === 'preview' ? 'missing' : audio?.recognition?.status ?? 'missing',
      labels: shown.filter(s => tier === 'all' || (!s.maybe && !s.uncalibrated && !s.coverageUnknown && s.tier !== 'possible'))
        .map(s => `${s.dimension}:${s.label}`) };
  });
}

