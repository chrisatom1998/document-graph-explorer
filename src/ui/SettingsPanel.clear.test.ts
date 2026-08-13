import { beforeEach, describe, expect, it, vi } from 'vitest';

const coordinator = vi.hoisted(() => ({ resetCorpus: vi.fn() }));
vi.mock('../pipeline/coordinator', () => coordinator);

import { useCorpusStore } from '../store/corpusStore';
import { resetClearedDataState } from './SettingsPanel';

describe('SettingsPanel clear-all live state', () => {
  beforeEach(() => {
    coordinator.resetCorpus.mockClear();
    useCorpusStore.setState({
      initialized: true,
      switching: false,
      activeCorpusId: 'ghost',
      activeName: 'Ghost workspace',
      mode: 'local',
      corpora: [
        {
          id: 'ghost',
          name: 'Ghost workspace',
          updatedAt: 1,
          documentCount: 4,
          watching: false,
        },
      ],
    });
  });

  it('resets both the graph runtime and the corpus catalog', () => {
    resetClearedDataState();

    expect(coordinator.resetCorpus).toHaveBeenCalledOnce();
    expect(useCorpusStore.getState()).toMatchObject({
      initialized: false,
      activeCorpusId: null,
      activeName: 'My corpus',
      corpora: [],
    });
  });
});
