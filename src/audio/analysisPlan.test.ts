import {describe,it,expect} from 'vitest';
import {descriptionStarts,songReviewStarts} from './analysisPlan';
describe('song coverage',()=>{
 it('checks the whole track including the final partial section in Full mode',()=>{
  expect(descriptionStarts(31,'full')).toEqual([0,10,20,30]);
  expect(descriptionStarts(180,'full')).toHaveLength(18);
 });
 it('keeps Fast mode bounded',()=>expect(descriptionStarts(180,'fast')).toEqual([85]));
 it('samples the beginning and end without overlapping song excerpts',()=>{
  const starts=songReviewStarts(245);expect(starts).toHaveLength(12);expect(starts[0]).toBe(0);expect(starts.at(-1)).toBe(235);
  expect(starts.slice(1).every((s,i)=>s-starts[i]>=10)).toBe(true);
  expect(songReviewStarts(8)).toEqual([0]);expect(songReviewStarts(25)).toEqual([0,15]);
 });
 it('rejects invalid duration',()=>{for(const d of [0,-1,NaN,Infinity]){expect(songReviewStarts(d)).toEqual([]);expect(descriptionStarts(d,'full')).toEqual([]);}});
});
