import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphExport } from '../model/types';
import { useCorpusStore } from '../store/corpusStore';
import { useUiStore } from '../store/uiStore';

const decodeShareFragment = vi.fn();
const importGraphExportData = vi.fn();
const initializeCorpusRepository = vi.fn();
const reportPersistenceUnavailable = vi.fn();

vi.mock('./shareUrl', async () => {
  const actual = await vi.importActual<typeof import('./shareUrl')>('./shareUrl');
  return {
    ...actual,
    decodeShareFragment: (...args: unknown[]) => decodeShareFragment(...args),
  };
});

vi.mock('./exportImport', () => ({
  importGraphExportData: (...args: unknown[]) => importGraphExportData(...args),
}));

vi.mock('./corpusRepository', () => ({
  initializeCorpusRepository: (...args: unknown[]) => initializeCorpusRepository(...args),
}));

vi.mock('./cache', () => ({
  reportPersistenceUnavailable: (...args: unknown[]) => reportPersistenceUnavailable(...args),
}));

import { applyShareUrlFromLocation, resetShareBootstrapForTests } from './shareBootstrap';

const sharedGraph: GraphExport = {
  version: 1,
  createdAt: '2026-08-17T00:00:00.000Z',
  generator: 'knowledge-nebula',
  includeEmbeddings: false,
  clusterNames: {},
  nodes: [
    {
      id: 'n0',
      kind: 'document',
      title: 'Shared doc',
      fileType: 'md',
      topics: [],
      entities: [],
      keywords: [],
      wordCount: 12,
      cluster: 0,
      degree: 0,
      status: 'ok',
      summary: 'A portable summary.',
    },
  ],
  edges: [],
};

describe('applyShareUrlFromLocation', () => {
  beforeEach(() => {
    resetShareBootstrapForTests();
    decodeShareFragment.mockReset();
    importGraphExportData.mockReset();
    initializeCorpusRepository.mockReset();
    reportPersistenceUnavailable.mockReset();
    decodeShareFragment.mockResolvedValue(sharedGraph);
    importGraphExportData.mockResolvedValue({ nodes: sharedGraph.nodes, edges: [] });
    initializeCorpusRepository.mockResolvedValue('corpus-1');
    useCorpusStore.setState({
      initialized: false,
      mode: 'local',
      activeCorpusId: null,
      activeName: 'My corpus',
      corpora: [],
      switching: false,
    });
    useUiStore.setState({ toasts: [] });
  });

  afterEach(() => {
    resetShareBootstrapForTests();
  });

  it('returns none when the location has no share fragment', async () => {
    await expect(
      applyShareUrlFromLocation({ href: 'https://example.test/', hash: '' }),
    ).resolves.toBe('none');
    expect(decodeShareFragment).not.toHaveBeenCalled();
    expect(importGraphExportData).not.toHaveBeenCalled();
  });

  it('opens query-only share URLs after a messenger drops the hash', async () => {
    const result = await applyShareUrlFromLocation({
      href: 'https://example.test/?graph=v1.abc',
      hash: '',
    });
    expect(result).toBe('opened');
    expect(decodeShareFragment).toHaveBeenCalledWith('#graph=v1.abc');
    expect(importGraphExportData).toHaveBeenCalledWith(sharedGraph, 'shared');
  });

  it('opens encoded share URLs that never reach location.hash', async () => {
    const result = await applyShareUrlFromLocation({
      href: 'https://example.test/%23graph%3Dv1.abc',
      hash: '',
    });
    expect(result).toBe('opened');
    expect(initializeCorpusRepository).toHaveBeenCalledOnce();
    expect(decodeShareFragment).toHaveBeenCalledWith('#graph=v1.abc');
    expect(importGraphExportData).toHaveBeenCalledWith(sharedGraph, 'shared');
    expect(useCorpusStore.getState().mode).toBe('local'); // import is mocked
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/opened a shared graph/i);
  });

  it('does not re-import the same fragment while a shared graph is already open', async () => {
    useCorpusStore.setState({ initialized: true, mode: 'shared' });
    await applyShareUrlFromLocation({
      href: 'https://example.test/#graph=v1.abc',
      hash: '#graph=v1.abc',
    });
    decodeShareFragment.mockClear();
    importGraphExportData.mockClear();
    initializeCorpusRepository.mockClear();

    await expect(
      applyShareUrlFromLocation({
        href: 'https://example.test/#graph=v1.abc',
        hash: '#graph=v1.abc',
      }),
    ).resolves.toBe('opened');
    expect(initializeCorpusRepository).not.toHaveBeenCalled();
    expect(decodeShareFragment).not.toHaveBeenCalled();
    expect(importGraphExportData).not.toHaveBeenCalled();
  });

  it('surfaces an invalid fragment without restoring a local corpus', async () => {
    decodeShareFragment.mockRejectedValueOnce(new Error('The shared graph link is malformed.'));
    const result = await applyShareUrlFromLocation({
      href: 'https://example.test/#graph=v1.nope',
      hash: '#graph=v1.nope',
    });
    expect(result).toBe('invalid');
    expect(useCorpusStore.getState().mode).toBe('shared');
    expect(useCorpusStore.getState().activeName).toBe('Invalid shared graph');
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/malformed/i);
  });
});
