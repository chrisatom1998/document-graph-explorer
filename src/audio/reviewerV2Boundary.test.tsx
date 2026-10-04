// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {render,screen} from '@testing-library/react';
import {musicCopilotAnswer} from '../chat/musicCopilot';
import CopilotProperties from '../ui/CopilotProperties';
import type {DocNode} from '../model/types';
const fixture=(decision:'rejected'|'uncertain'):DocNode=>({id:'qa',kind:'document',fileType:'audio',title:'distorted riser.wav',topics:[],entities:[],keywords:[],wordCount:0,cluster:0,degree:0,status:'ok',audio:{version:2,durationSeconds:8,analyzedSeconds:8,instruments:[],notes:[],copilotProperties:{model:'old-draft',tags:{source:[],production:['riser'],character:['distorted']}},soundReviews:[{dimension:'character',labelId:'distorted',decision,scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'old-run'},{dimension:'effect',labelId:'riser',decision,scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'old-run'}]}});
it.each(['rejected','uncertain'] as const)('no local copilot positive match for %s title label',decision=>{
 const n=fixture(decision);
 expect(musicCopilotAnswer('Find distorted samples',[n],[],null).sources).toHaveLength(0);
});
it.each(['rejected','uncertain'] as const)('no current AI property claim for %s label',decision=>{
 render(<CopilotProperties audio={fixture(decision).audio!}/>);
 expect(screen.queryByText('production: riser · character: distorted')).not.toBeInTheDocument();
});
