import {it,expect,vi} from 'vitest';
import {DecodedMusicCache,musicDecoderFromSnapshot} from './musicDecodedCache';
const snapshot=()=>({durationSeconds:10,rates:new Map([16000,44100,48000].map(r=>[r,Float32Array.from({length:r*10},(_,i)=>i%200/200)]))});
it('reuses exact native PCM with owned output buffers and bounds retained snapshots',async()=>{
 const cache=new DecodedMusicCache(),a=snapshot();cache.remember('a',a);cache.remember('b',snapshot());cache.remember('c',snapshot());expect(cache.take('a')).toBeUndefined();const b=cache.take('b')!;expect(cache.take('b')).toBeUndefined();const open=vi.fn();const d=musicDecoderFromSnapshot(b,open);const output=await d.read(1,2,16000);expect(output).toEqual(b.rates.get(16000)!.slice(16000,48000));output[0]=99;expect(b.rates.get(16000)![16000]).not.toBe(99);expect(open).not.toHaveBeenCalled();d.close();await expect(d.read(0,1,16000)).rejects.toThrow('closed');
});
it('keeps unknown rates on the real decoder and closes it once after cancellation',async()=>{
 const fallback={durationSeconds:10,read:vi.fn(async()=>new Float32Array(320000)),close:vi.fn()},open=vi.fn(async()=>fallback),control=new AbortController();const d=musicDecoderFromSnapshot(snapshot(),open,control.signal);await d.read(0,10,32000);await d.read(0,10,32000);expect(open).toHaveBeenCalledTimes(1);expect(fallback.read).toHaveBeenCalledTimes(2);control.abort();d.close();await Promise.resolve();expect(fallback.close).toHaveBeenCalledTimes(1);await expect(d.read(0,10,16000)).rejects.toThrow();
});
it('rejects unbounded, long, incomplete or wrong-rate snapshots',()=>{
 const c=new DecodedMusicCache();for(const s of [{...snapshot(),durationSeconds:31},{durationSeconds:10,rates:new Map([[16000,new Float32Array(1)]])},{...snapshot(),rates:new Map([[1,new Float32Array(1)],[2,new Float32Array(1)],[3,new Float32Array(1)]])}]){c.remember('a',s);expect(c.take('a')).toBeUndefined();}
});
