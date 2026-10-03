import {afterEach,it,expect,vi} from 'vitest';
import {quickMusic} from './quickMusic';
import type {MusicAnalysis} from './musicTypes';
afterEach(()=>vi.useRealTimers());
const result:MusicAnalysis={version:2,durationSeconds:30,analyzedSeconds:10,instruments:[],notes:[]};
it('returns a truthful waiting result at fourteen seconds while work continues',async()=>{
 vi.useFakeTimers();let finish!:(r:MusicAnalysis)=>void;
 const job=quickMusic(()=>new Promise(r=>{finish=r;}));
 let initial=false;void job.initial.then(()=>{initial=true;});
 await vi.advanceTimersByTimeAsync(13999);expect(initial).toBe(false);
 await vi.advanceTimersByTimeAsync(1);expect(await job.initial).toMatchObject({stage:'preview',instruments:[],durationSeconds:0});
 finish(result);expect(await job.complete).toBe(result);
});
it('waits beyond the first instrument guess and returns the richest preview at the deadline',async()=>{
 vi.useFakeTimers();let finish!:(r:MusicAnalysis)=>void;
 let preview!:(r:MusicAnalysis)=>void;
 const job=quickMusic(p=>{preview=p;return new Promise(r=>{finish=r;});});
 let initial=false;void job.initial.then(()=>{initial=true;});
 await vi.advanceTimersByTimeAsync(1);
 preview({...result,stage:'preview',instruments:[{label:'piano',status:'possible',score:.7}]});
 await vi.advanceTimersByTimeAsync(9999);expect(initial).toBe(false);
 const richer={...result,stage:'preview' as const,tempo:{bpm:120,confidence:.8},key:{tonic:0,mode:'major' as const,strength:.7}};
 preview(richer);
 await vi.advanceTimersByTimeAsync(4000);expect(await job.initial).toBe(richer);
 finish(result);expect(await job.complete).toBe(result);
});
it('returns completed Quick details early instead of its preliminary instrument guess',async()=>{
 const job=quickMusic(async preview=>{preview({...result,stage:'preview'});return result;});
 expect(await job.initial).toBe(result);expect(await job.complete).toBe(result);
});
it('returns a cached or fast completion directly',async()=>{expect(await quickMusic(async()=>result).initial).toBe(result);});
it('rejects cancellation without publishing a waiting result later',async()=>{
 vi.useFakeTimers();const controller=new AbortController();
 const job=quickMusic(()=>new Promise(()=>{}),controller.signal);
 const rejected=expect(job.initial).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;
 await vi.advanceTimersByTimeAsync(15000);
});
