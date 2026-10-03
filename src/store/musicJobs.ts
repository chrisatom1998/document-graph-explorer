import {create} from 'zustand';
interface MusicJobs { jobs:Record<string,string>; minimized:boolean; }
export const useMusicJobs=create<MusicJobs>(()=>({jobs:{},minimized:false}));
const controllers=new Map<string,AbortController>();
export function beginMusicJob(id:string){
 controllers.get(id)?.abort();
 const controller=new AbortController();controllers.set(id,controller);
 useMusicJobs.setState(s=>({jobs:{...s.jobs,[id]:'Preparing audio'}}));
 return controller;
}
export function isCurrentMusicJob(id:string,controller:AbortController){return controllers.get(id)===controller&&!controller.signal.aborted;}
export function updateMusicJob(id:string,controller:AbortController,note:string){if(isCurrentMusicJob(id,controller))useMusicJobs.setState(s=>({jobs:{...s.jobs,[id]:note}}));}
export function finishMusicJob(id:string,controller:AbortController){
 if(controllers.get(id)!==controller)return;
 controllers.delete(id);useMusicJobs.setState(s=>{const jobs={...s.jobs};delete jobs[id];return {jobs};});
}
export function cancelMusicJob(id:string){const c=controllers.get(id);if(c){c.abort();finishMusicJob(id,c);}}
export function cancelAllMusicJobs(){for(const id of controllers.keys())cancelMusicJob(id);}
