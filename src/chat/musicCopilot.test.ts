import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import { musicCopilotAnswer, musicEvidence } from './musicCopilot';
const sample = (id: string, bpm = 140, instrument = 'synthesizer'): DocNode => ({
  id, title: id, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok',
  audio: { version: 2, durationSeconds: 12, analyzedSeconds: 12, tempo: { bpm, confidence: .8 }, key: { tonic: 3, mode: 'minor', strength: .8 }, confirmedInstruments: [instrument], instruments: [], notes: [] },
});
describe('music copilot', () => {
  it('searches a BPM range and instrument without returning unrelated tracks', () => {
    const answer = musicCopilotAnswer('Find synths between 135 and 145 BPM', [sample('Alpha'), sample('Slow', 90), sample('Drum', 140, 'drum kit')], [], null);
    expect(answer.sources.map(s => s.docId)).toEqual(['Alpha']);
    expect(answer.text).toContain('confirmed by you');
  });
  it('matches enharmonic keys', () => {
    expect(musicCopilotAnswer('Find D# minor samples', [sample('Alpha')], [], null).sources).toHaveLength(1);
    expect(musicCopilotAnswer('Find Eb minor samples', [sample('Alpha')], [], null).sources).toHaveLength(1);
    expect(musicCopilotAnswer('Find E minor samples', [sample('Alpha')], [], null).sources).toHaveLength(0);
  });
  it('uses current corrections instead of superseded model guesses', () => {
    const node = sample('Alpha', 140, 'trumpet');
    node.audio!.instrumentPrediction = { label: 'synthesizer', score: .9, margin: .2 };
    expect(musicEvidence(node)).toContain('trumpet (confirmed by you)');
    expect(musicEvidence(node)).not.toContain('synthesizer');
    expect(musicCopilotAnswer('Find synths', [node], [], null).sources).toHaveLength(0);
    node.title = 'Old synthesizer tag';
    expect(musicCopilotAnswer('Find synthesizer samples', [node], [], null).sources).toHaveLength(0);
  });
  it('uses a later source review over an earlier instrument confirmation', () => {
    const node = sample('Alpha', 140, 'synthesizer');
    node.audio!.soundReviews = [{ labelId: 'synthesizer', dimension: 'source', decision: 'rejected', scope: 'track', at: '2026-10-03T00:00:00Z', evidenceRunId: 'older-run' }];
    expect(musicEvidence(node)).not.toContain('synthesizer (confirmed by you)');
    expect(musicCopilotAnswer('Find synthesizer samples', [node], [], null).sources).toHaveLength(0);
  });
  it('preserves missing analysis instead of inventing matches', () => {
    const node = sample('Unknown'); delete node.audio;
    expect(musicCopilotAnswer('Show uncertain samples', [node], [], null).text).toContain('unknown tempo');
    expect(musicCopilotAnswer('Find matches for this sample', [node, sample('Alpha')], [], node.id).sources.map(s => s.docId)).toEqual(['Unknown']);
    expect(musicCopilotAnswer('Find matches', [node], [], null).text).toContain('Select a sample');
  });
  it('returns evidence for both the selected sample and its matches', () => {
    const answer = musicCopilotAnswer('Find matches for this sample', [sample('Alpha'), sample('Beta')], [], 'Alpha');
    expect(answer.sources.map(s => s.docId)).toEqual(['Alpha', 'Beta']);
    expect(answer.chunks.some(chunk => chunk.text.includes('Similar estimated tempo'))).toBe(true);
    expect(answer.text).toContain('Audition them together');
  });
  it('compares two named samples and does not include documents', () => {
    const doc = { ...sample('Document'), fileType: 'txt' as const };
    const answer = musicCopilotAnswer('Compare Alpha and Beta', [sample('Alpha'), sample('Beta'), doc], [], null);
    expect(answer.sources.map(s => s.docId)).toEqual(['Alpha', 'Beta']);
  });
});

it.each(['rejected','uncertain'] as const)('honors %s source reviews across tag, title, and estimate fallback',decision=>{
 const node=sample('piano.wav',140,'piano');
 node.audio!.confirmedDjTags={source:['piano'],production:[],character:[]};
 node.audio!.soundReviews=[{labelId:'piano',dimension:'source',decision,scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'run'}];
 expect(musicEvidence(node)).not.toContain('piano');
 expect(musicCopilotAnswer('Find piano samples',[node],[],null).sources).toHaveLength(0);
 delete node.audio!.confirmedInstruments;delete node.audio!.confirmedDjTags;
 node.audio!.instrumentPrediction={label:'piano',score:.99,margin:.1};
 expect(musicEvidence(node)).not.toContain('piano');
 expect(musicCopilotAnswer('Find piano samples',[node],[],null).sources).toHaveLength(0);
});
