import { expect, it } from 'vitest';
import { scoreTempo, scoreKey, intervalOverlap, runtimeSummary } from './evaluationSignals';
it('separates exact tempo, half/double tolerance and no-pulse handling',()=>{
  expect(scoreTempo(140,70,.04)).toMatchObject({strict:false,halfDouble:true});
  expect(scoreTempo(140,141,.04)).toMatchObject({strict:true,halfDouble:true});
  expect(scoreTempo(null,null,.04)).toEqual({strict:null,halfDouble:null,noPulseCorrect:true});
  expect(scoreTempo(140,null,.04).strict).toBe(false);
  expect(()=>scoreTempo(-1,100,.04)).toThrow();
});
it('separates exact key from related credit and no-key handling',()=>{
  const c={tonic:0,mode:'major' as const};
  expect(scoreKey(c,{tonic:7,mode:'major'})).toMatchObject({exact:false,weighted:.5});
  expect(scoreKey(c,{tonic:5,mode:'major'}).weighted).toBe(.5);
  expect(scoreKey(c,{tonic:9,mode:'minor'}).weighted).toBe(.3);
  expect(scoreKey(c,{tonic:0,mode:'minor'}).weighted).toBe(.2);
  expect(scoreKey(c,c).exact).toBe(true);
  expect(scoreKey(null,null).noKeyCorrect).toBe(true);
  expect(()=>scoreKey(c,{tonic:12,mode:'major'})).toThrow();
});
it('scores window overlap without inventing precise event boundaries',()=>{
  expect(intervalOverlap({start:0,end:10},{start:5,end:15})).toBeCloseTo(1/3);
  expect(intervalOverlap({start:0,end:10},{start:10,end:20})).toBe(0);
});
it('keeps performance profiles and cold/warm measurements separate',()=>{
  expect(runtimeSummary([{profile:'test-browser',cold:true,durationSeconds:10,elapsedMs:2000,status:'complete'},
    {profile:'test-browser',cold:false,durationSeconds:10,elapsedMs:1000,status:'failed'}])).toMatchObject([
      {profile:'test-browser',cold:true,runs:1,meanRealTimeFactor:.2,failures:0,peakMemoryBytes:null},
      {profile:'test-browser',cold:false,runs:1,meanRealTimeFactor:.1,failures:1},
    ]);
});
