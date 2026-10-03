import {describe,it,expect} from 'vitest';
import {songInstrumentTags,songInstrumentCandidates,songMusicEvidence} from './songRecognition';
describe('song instrument evidence',()=>{
 it('allows multiple instruments and distinguishes weak candidates from labels',()=>{
  const scores={piano:.8,tabla:.6,flute:.12,guitar:.9,voice:NaN};
  expect(songInstrumentTags(scores).map(t=>t.label)).toEqual(['piano','tabla']);
  expect(songInstrumentCandidates(scores).map(t=>t.label)).toContain('flute');
  expect(songInstrumentTags(scores).some(t=>t.label==='flute')).toBe(false);
 });
 it('does not turn broad music roles into instrument facts',()=>{
  const result=songMusicEvidence({bass:.9,beat:.8,pad:.7,computer:.8,piano:.6,drums:.7});
  expect(result.tags.map(t=>t.label).sort()).toEqual(['drums','piano']);
  expect(result.tags.every(t=>t.model==='MTG-Jamendo')).toBe(true);
 });
 it('rejects invalid scores',()=>{
  expect(songInstrumentTags({piano:Infinity,flute:-1,tabla:2})).toEqual([]);
  expect(songInstrumentCandidates({piano:NaN,flute:2})).toEqual([]);
 });
});
