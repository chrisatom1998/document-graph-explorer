import type {MusicAnalysis} from './musicTypes';
export const QUICK_MUSIC_DEADLINE_MS = 14000;
/** Return an early result by the deadline without cancelling the continuing analysis. */
export function quickMusic(run: (preview: (result:MusicAnalysis)=>void)=>Promise<MusicAnalysis>, signal?:AbortSignal) {
 let settled=false;
 let latestPreview:MusicAnalysis|undefined;
 let resolveInitial!:(result:MusicAnalysis)=>void;
 let rejectInitial!:(reason:unknown)=>void;
 const initial=new Promise<MusicAnalysis>((resolve,reject)=>{resolveInitial=resolve;rejectInitial=reject;});
 const finish=(result:MusicAnalysis)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolveInitial(result);};
 const fail=(error:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);rejectInitial(error);};
 const abort=()=>fail(signal?.reason??new DOMException('Cancelled','AbortError'));
 const timer=setTimeout(()=>finish(latestPreview??{version:2,stage:'preview',durationSeconds:0,analyzedSeconds:0,instruments:[],notes:['Still analyzing in the background. No sound prediction is available yet.']}),QUICK_MUSIC_DEADLINE_MS);
 signal?.addEventListener('abort',abort,{once:true});
 const complete=Promise.resolve().then(()=>{signal?.throwIfAborted();return run(preview=>{latestPreview=preview;});});
 void complete.then(finish,fail);
 return {initial,complete};
}
