import { describe, expect, it } from 'vitest';
import { createRecognition, finishJob, recordEvidence, sanitizeRecognition, modelCacheKey, ResultCache, familyOf } from './recognition';
import { sanitizeMusicAnalysis } from './musicTypes';
import { reliableInstruments } from './instrumentEvidence';

describe('versioned recognition evidence', () => {
  it('keeps specific instrument families distinct from substring collisions', () => {
    expect(familyOf('bass drum')).toBe('drums');
    expect(familyOf('bassoon')).toBe('woodwind');
    expect(familyOf('harpsichord')).toBe('keys');
  });
  it('does not count repeated successes as missing planned windows', () => {
    const job=createRecognition(20,'full').jobs[0];
    job.planned=[{start:0,end:10},{start:10,end:20}]; job.attempted=[...job.planned];
    job.successful=[job.planned[0],job.planned[0]];
    finishJob(job,20);
    expect(job.status).toBe('partial'); expect(job.successful).toHaveLength(1);
  });
  it('rejects invalid cache capacities rather than entering an unbounded eviction loop', () => {
    expect(()=>new ResultCache(-1)).toThrow();
  });
  it('records processor padding separately from valid original audio', () => {
    const run=createRecognition(3,'full');
    recordEvidence(run,'clap',{start:0,end:3},[{dimension:'source',labelId:'piano',score:.6}]);
    expect(run.evidence[0]).toMatchObject({validSeconds:3,inputSeconds:3,padding:'repeatpad-to-10s'});
    expect(sanitizeRecognition(run,3)?.evidence[0]).toMatchObject({padding:'repeatpad-to-10s'});
  });
  it('unions successful intervals and reports real gaps independently', () => {
    const run = createRecognition(22, 'full', 'fingerprint');
    const job = run.jobs.find(j => j.modelId === 'ast')!;
    job.planned = [{start:0,end:10},{start:5,end:15},{start:12,end:22}];
    job.attempted = [...job.planned]; job.successful = [{start:0,end:10},{start:12,end:22}];
    finishJob(job, 22);
    expect(job.status).toBe('partial'); expect(job.analyzedSeconds).toBe(20);
    expect(job.gaps).toEqual([{start:10,end:12}]);
  });
  it('keeps simultaneous sources and raw scores with deduplicated evidence', () => {
    const run=createRecognition(10,'full','fingerprint');
    for(let i=0;i<2;i++) recordEvidence(run,'jamendo',{start:0,end:10},[
      {dimension:'source',labelId:'oboe',score:.7},{dimension:'source',labelId:'viola',score:.6},
      {dimension:'role',labelId:'pad',score:.8},
    ]);
    expect(run.observations.map(o=>o.labelId)).toEqual(['oboe','viola','pad']);
    expect(run.evidence).toHaveLength(3);
    expect(run.observations.every(o=>o.status==='possible' && o.confidence===undefined)).toBe(true);
    const saved=sanitizeMusicAnalysis({version:2,durationSeconds:10,analyzedSeconds:0,instruments:[],notes:[],recognition:run,confirmedInstruments:['piano']});
    expect(saved?.recognition?.evidence).toEqual(run.evidence);
    expect(saved?.confirmedInstruments).toEqual(['piano']);
  });
  it('preserves scoped human review separately from changing machine evidence', () => {
    const run=createRecognition(10,'full');
    const review={dimension:'source',labelId:'oboe',decision:'confirmed',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'older-run'} as const;
    const audio=sanitizeMusicAnalysis({version:2,durationSeconds:10,analyzedSeconds:0,instruments:[],notes:[],recognition:run,soundReviews:[review]});
    expect(audio?.soundReviews).toEqual([review]);
    expect(reliableInstruments(audio!)).toEqual([{label:'oboe',score:1}]);
    const rejected=sanitizeMusicAnalysis({...audio,soundReviews:[{...review,decision:'rejected'}]});
    expect(reliableInstruments(rejected!)).toEqual([]);
    expect(reliableInstruments({version:2,durationSeconds:10,analyzedSeconds:0,instruments:[],notes:[],recognition:run,confirmedInstruments:['piano','trumpet'],soundReviews:[{...review,labelId:'trumpet',decision:'rejected'}]})).toEqual([{label:'piano',score:1}]);
    expect(reliableInstruments({version:2,durationSeconds:10,analyzedSeconds:0,instruments:[],notes:[],recognition:run,soundReviews:[{...review,decision:'uncertain'}]})).toEqual([]);
  });
  it('rejects hostile intervals, dangling evidence and unsupported acceptance', () => {
    const run=createRecognition(10,'full');
    recordEvidence(run,'ast',{start:0,end:10},[{dimension:'source',labelId:'piano',score:.9}]);
    run.observations[0].status='accepted';run.observations[0].confidence=.999;
    run.evidence[0].start=-1;
    const restored=sanitizeRecognition(run,10);
    expect(restored?.evidence).toEqual([]);
    expect(restored?.observations).toEqual([]);
  });
  it('never promotes new uncalibrated detections through legacy graph fields', () => {
    const run=createRecognition(10,'full');
    expect(reliableInstruments({version:2,durationSeconds:10,analyzedSeconds:0,instruments:[{label:'piano',score:.99,status:'likely'}],notes:[],recognition:run})).toEqual([]);
  });
  it('keys cached results by relevant provenance and bounds retention', () => {
    const run=createRecognition(10,'full','audio');const model=run.jobs[0];
    const key=modelCacheKey('audio',model,{start:0,end:10});
    expect(modelCacheKey('audio',{...model,preprocessingVersion:'changed'},{start:0,end:10})).not.toBe(key);
    expect(modelCacheKey('other',model,{start:0,end:10})).not.toBe(key);
    const cache=new ResultCache(2);cache.set('a',{x:1});cache.set('b',{x:2});cache.set('c',{x:3});
    expect(cache.get('a')).toBeUndefined();expect(cache.size).toBe(2);
    const value=cache.get<{x:number}>('b')!;value.x=99;
    expect(cache.get('b')).toEqual({x:2});
  });
});

it('preserves a vocal-derived voice score and rejects invalid provenance',()=>{
 const run=createRecognition(3,'full');
 recordEvidence(run,'clap',{start:0,end:3},[{dimension:'source',labelId:'voice',score:.5,derivedFrom:{group:'sample',labelId:'vocal chops'}}]);
 expect(sanitizeRecognition(run,3)?.evidence).toEqual(run.evidence);
 run.evidence[0].derivedFrom!.labelId='synthesizer';
 expect(sanitizeRecognition(run,3)?.evidence).toEqual([]);
 expect(sanitizeRecognition(run,3)?.observations).toEqual([]);
});
