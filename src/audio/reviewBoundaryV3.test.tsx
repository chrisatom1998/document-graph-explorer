// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {musicCopilotAnswer} from '../chat/musicCopilot';
import CopilotProperties from '../ui/CopilotProperties';
import {projectedCopilotProperties} from './soundReviewPolicy';
import type {DocNode} from '../model/types';
afterEach(cleanup);
const fixture=():DocNode=>({id:'qa',kind:'document',fileType:'audio',title:'distorted riser.wav',topics:[],entities:[],keywords:[],wordCount:0,cluster:0,degree:0,status:'ok',audio:{version:2,durationSeconds:8,analyzedSeconds:8,instruments:[],notes:[],copilotProperties:{model:'draft',tags:{source:[],production:['riser'],character:['distorted']}},soundReviews:[{dimension:'character',labelId:'distorted',decision:'rejected',scope:'track',at:'2026-10-03',evidenceRunId:'old'},{dimension:'effect',labelId:'riser',decision:'uncertain',scope:'track',at:'2026-10-03',evidenceRunId:'old'}]}});
it.each(['Find distorted samples','Find distortion samples','Find upsweep samples','Find distorted sounds in this selected sample'])('blocks semantic revival: %s',query=>{
 const n=fixture();expect(musicCopilotAnswer(query,[n],[],n.id).sources).toHaveLength(0);
});
it.each(['Find filenames containing distorted','Find file named "distorted riser.wav"','Find filenames containing riser'])('preserves explicit filename lookup: %s',query=>{
 const n=fixture(),result=musicCopilotAnswer(query,[n],[],null);
 expect(result.sources).toHaveLength(1);expect(result.text).toContain('Filename text does not establish sound categories.');
});
it('preserves ordinary unrelated title discovery',()=>{
 const n=fixture();n.title='warehouse distorted riser.wav';expect(musicCopilotAnswer('Find warehouse samples',[n],[],null).sources).toHaveLength(1);
});
it('reconfirmation restores current category evidence without erasing raw history',()=>{
 const n=fixture();n.audio!.soundReviews!.push({...n.audio!.soundReviews![0],decision:'confirmed'});
 const before=JSON.stringify(n);expect(musicCopilotAnswer('Find distortion samples',[n],[],null).sources).toHaveLength(1);
 expect(projectedCopilotProperties(n.audio!).historical[1].reason).toBe('confirmed by you');expect(JSON.stringify(n)).toBe(before);
});
it('separates current suggestions from rejected and uncertain historical drafts',()=>{
 const n=fixture();n.audio!.copilotProperties!.tags.source=['piano'];const before=JSON.stringify(n);
 render(<CopilotProperties audio={n.audio!}/>);
 expect(screen.getByText('source: piano')).toBeInTheDocument();
 expect(screen.getByText(/character: distorted — rejected by you; historical/)).toBeInTheDocument();
 expect(screen.getByText(/production: riser — uncertain by you; historical/)).toBeInTheDocument();
 expect(JSON.stringify(n)).toBe(before);
});
it('preserves unreviewed current suggestions',()=>{
 const n=fixture();n.audio!.soundReviews=[];
 expect(projectedCopilotProperties(n.audio!).current.map(t=>t.label)).toEqual(['riser','distorted']);
});
it('a confirmed source review supersedes other AI source guesses consistently with sample search',()=>{
 const n=fixture();n.audio!.copilotProperties!.tags.source=['piano'];n.audio!.soundReviews!.push({dimension:'source',labelId:'guitar',decision:'confirmed',scope:'track',at:'2026-10-03',evidenceRunId:'old'});
 expect(projectedCopilotProperties(n.audio!).current).toEqual([]);
});
it('an explicit empty correction supersedes historical AI drafts',()=>{
 const n=fixture();n.audio!.soundReviews=[];n.audio!.confirmedDjTags={source:[],production:[],character:[]};
 expect(projectedCopilotProperties(n.audio!).current).toEqual([]);
});
