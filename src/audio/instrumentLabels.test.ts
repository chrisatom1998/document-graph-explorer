import { expect, it } from 'vitest';
import { instrumentScores, INSTRUMENT_LABELS } from './instrumentLabels';
it('combines speech and singing classes by strongest evidence without overwriting them', () => {
 const scores=instrumentScores([4,-4,1,0,-1,7,8],{'0':'Speech','1':'Singing','2':'Choir','3':'Rapping','4':'Humming','5':'Speech synthesizer','6':'Music'});
 expect(scores).toEqual({voice:1/(1+Math.exp(-4))});
 expect(INSTRUMENT_LABELS.filter(label=>label==='voice')).toHaveLength(1);
});
it('keeps instruments alongside voice and ignores invalid scores', () => {
 const scores=instrumentScores([2,3,NaN],{'0':'Synthesizer','1':'Singing','2':'Speech'});
 expect(scores.synthesizer).toBeGreaterThan(.8);
 expect(scores.voice).toBeGreaterThan(.9);
});
