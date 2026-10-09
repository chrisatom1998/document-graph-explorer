import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCopilotProperties, copilotCorpusIdentity } from './applyCopilotProperties';
import { copilotEvidence } from './copilotEvidence';
import { useGraphStore } from '../store/graphStore';
import { useCorpusStore } from '../store/corpusStore';
import { saveAudioGraph } from './saveAudioGraph';
import type { DocNode } from '../model/types';
vi.mock('./saveAudioGraph', () => ({ saveAudioGraph: vi.fn(async () => 'saved') }));
vi.mock('../persistence/sessionSave', () => ({ saveSession: vi.fn(async () => {}) }));
const tags = { source: ['voice'], production: ['vocal chops'], character: [] };
const node: DocNode = { id: 'one', title: 'one.wav', kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: -1, status: 'ok',
  audio: { version: 2, durationSeconds: 2, analyzedSeconds: 2, instruments: [], notes: [], tempo: { bpm: 120, confidence: .9 }, confirmedInstruments: ['piano'] } };
const input = () => ({ ids: ['one'], evidence: [copilotEvidence(node, 0)!], suggestions: [{ ref: 'Sample 1', tags }], model: 'gpt-6.1-sol', corpus: copilotCorpusIdentity() });
beforeEach(() => {
  vi.clearAllMocks(); useCorpusStore.getState().reset();
  useGraphStore.setState({ nodes: [structuredClone(node)], nodeIndex: { one: 0 }, phase: 'ready', corpusHash: 'test' });
});
describe('apply copilot properties', () => {
  it('saves listening coverage alongside unverified tags while preserving measured tempo', async () => {
    await applyCopilotProperties({ ...input(), model: 'gpt-audio-1.5', listening: [{ ref: 'Sample 1', startSeconds: 0, durationSeconds: 2 }] });
    const audio = useGraphStore.getState().nodes[0].audio!;
    expect(audio.copilotProperties).toMatchObject({ model: 'gpt-audio-1.5', audioExcerpt: { startSeconds: 0, durationSeconds: 2 } });
    expect(audio.tempo).toEqual(node.audio!.tempo);
    expect(audio.confirmedInstruments).toEqual(['piano']);
  });
  it('adds properties and preserves measurements and human corrections', async () => {
    expect(await applyCopilotProperties(input())).toContain('saved for 1 sound');
    const audio = useGraphStore.getState().nodes[0].audio!;
    expect(audio.confirmedInstruments).toEqual(['piano']);
    expect(audio.tempo).toEqual(node.audio!.tempo);
    expect(audio.confirmedDjTags).toBeUndefined();
    expect(audio.copilotProperties!.tags).toEqual({ ...tags, source: [] });
    expect(saveAudioGraph).toHaveBeenCalledOnce();
  });
  it('rejects stale evidence or a different library before changing anything', async () => {
    const pending = input();
    useGraphStore.setState({ nodes: [{ ...node, audio: { ...node.audio!, confirmedDjTags: tags } }] });
    await expect(applyCopilotProperties(pending)).rejects.toThrow('evidence changed');
    expect(useGraphStore.getState().nodes[0].audio!.copilotProperties).toBeUndefined();
    useCorpusStore.setState({ activeCorpusId: 'different' });
    await expect(applyCopilotProperties(pending)).rejects.toThrow('library changed');
    expect(saveAudioGraph).not.toHaveBeenCalled();
  });
  it('keeps a failed save retryable without duplicating properties', async () => {
    const pending = input(); vi.mocked(saveAudioGraph).mockRejectedValueOnce(Error('quota'));
    await expect(applyCopilotProperties(pending)).rejects.toThrow('saving failed');
    expect(await applyCopilotProperties(pending)).toContain('saved for 1 sound');
    expect(useGraphStore.getState().nodes[0].audio!.copilotProperties!.tags.production).toEqual(['vocal chops']);
  });
});
