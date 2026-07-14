import { beforeEach, describe, expect, it } from 'vitest';
import { useCorpusStore, type CorpusSummary } from './corpusStore';

const corpora: CorpusSummary[] = [
  {
    id: 'work',
    name: 'Work notes',
    updatedAt: 20,
    documentCount: 4,
    watching: true,
  },
  {
    id: 'personal',
    name: 'Personal notes',
    updatedAt: 10,
    documentCount: 2,
    watching: false,
  },
];

describe('useCorpusStore', () => {
  beforeEach(() => {
    useCorpusStore.setState({
      initialized: false,
      switching: false,
      activeCorpusId: null,
      activeName: 'My corpus',
      mode: 'local',
      corpora: [],
    });
  });

  it('publishes a local corpus list and derives the active display name', () => {
    useCorpusStore.getState().setLocalState(corpora, 'personal');

    expect(useCorpusStore.getState()).toMatchObject({
      initialized: true,
      corpora,
      activeCorpusId: 'personal',
      activeName: 'Personal notes',
      mode: 'local',
    });
  });

  it('enters an ephemeral mode without discarding the local corpus catalog', () => {
    useCorpusStore.getState().setLocalState(corpora, 'work');
    useCorpusStore.getState().setSwitching(true);

    useCorpusStore.getState().setEphemeral('Shared graph', 'shared');

    expect(useCorpusStore.getState()).toMatchObject({
      initialized: true,
      switching: false,
      corpora,
      activeCorpusId: null,
      activeName: 'Shared graph',
      mode: 'shared',
    });
  });

  it('returns from an imported graph to the selected local corpus', () => {
    useCorpusStore.getState().setEphemeral('Imported graph', 'imported');

    useCorpusStore.getState().setLocalState(corpora, 'work');

    expect(useCorpusStore.getState()).toMatchObject({
      activeCorpusId: 'work',
      activeName: 'Work notes',
      mode: 'local',
    });
  });
});
