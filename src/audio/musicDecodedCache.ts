import type { MusicDecoder } from './decodeMusic';
export interface DecodedMusicSnapshot { durationSeconds: number; rates: ReadonlyMap<number, Float32Array> }
/** Two <=30second PCM snapshots, at most27MB; original bytes and user analysis are never persisted here. */
export class DecodedMusicCache {
 private entries = new Map<string, DecodedMusicSnapshot>();
 remember(key: string, snapshot: DecodedMusicSnapshot | undefined) {
  if (!snapshot || snapshot.durationSeconds <= 0 || snapshot.durationSeconds > 30 || snapshot.rates.size !== 3 || [16000,44100,48000].some(rate=>!snapshot.rates.has(rate) || snapshot.rates.get(rate)!.length>30*rate)) return;
  this.entries.delete(key); this.entries.set(key, snapshot);
  while (this.entries.size > 2) this.entries.delete(this.entries.keys().next().value!);
 }
 take(key: string) { const value=this.entries.get(key);this.entries.delete(key);return value; }
 forget(key: string) { this.entries.delete(key); }
}
/** Cached reads still return owned buffers. Uncached rates retain the original decoder path. */
export function musicDecoderFromSnapshot(snapshot: DecodedMusicSnapshot, openFallback:()=>Promise<MusicDecoder>, signal?:AbortSignal): MusicDecoder {
 let fallback:Promise<MusicDecoder>|undefined, closed=false;
 const check=()=>{signal?.throwIfAborted();if(closed)throw Error('The audio decoder was closed.');};
 const close=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',close);void fallback?.then(d=>d.close()).catch(()=>{});};
 signal?.addEventListener('abort',close,{once:true});
 return {durationSeconds:snapshot.durationSeconds,close,async read(start,seconds,rate){
  check();const samples=snapshot.rates.get(rate);
  if(samples){const from=Math.max(0,Math.round(start*rate));return samples.slice(from,Math.max(from,Math.round((start+seconds)*rate)));}
  const decoder=await(fallback??=openFallback());check();return decoder.read(start,seconds,rate);
 }};
}
