// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import MusicFeatures from './MusicFeatures';
import {createRecognition,recordEvidence} from '../audio/recognition';
import type {DocNode} from '../model/types';
afterEach(cleanup);
const fixture=():DocNode=>({id:'qa',kind:'document',fileType:'audio',title:'Piano distorted 140BPM Cminor.wav',topics:[],entities:[],keywords:[],wordCount:0,cluster:0,degree:0,status:'ok',audio:{version:2,durationSeconds:8,analyzedSeconds:8,instruments:[{label:'piano',score:.49,status:'possible'}],notes:[],tempo:{bpm:90,confidence:.2},key:{tonic:0,mode:'minor',strength:.2}}});
it('shows filename fallback separately from weak audio scores',()=>{
 render(<MusicFeatures node={fixture()}/>);const summary=screen.getByRole('region',{name:'Sound identification'});expect(within(summary).getByText('piano')).toBeVisible();expect(within(summary).getAllByText(/From filename/).length).toBeGreaterThan(0);expect(within(summary).queryByText(/0.490/)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/^(Confirm|Reject|Unsure)$/})).not.toBeInTheDocument();expect(screen.queryByText('Correct DJ tags')).not.toBeInTheDocument();
});
it('keeps measured admitted tempo/key as estimates and saved confirmed labels',()=>{
 const n=fixture();n.title='Neutral.wav';n.audio!.tempo={bpm:120,confidence:.9};n.audio!.key={tonic:2,mode:'minor',strength:.8};n.audio!.confirmedInstruments=['flute'];n.audio!.confirmedDjTags={source:['flute'],production:[],character:['bright']};render(<MusicFeatures node={n}/>);expect(screen.getByText('120.0 BPM')).toBeVisible();expect(screen.getByText('D minor',{selector:'dd'})).toBeVisible();const summary=screen.getByRole('region',{name:'Sound identification'});expect(within(summary).getByText('flute')).toBeVisible();expect(within(summary).getByText('bright')).toBeVisible();
});
it('removes review controls even inside diagnostics while retaining evidence seeking',()=>{
 const n=fixture();n.audio!.recognition=createRecognition(8,'full');recordEvidence(n.audio!.recognition,'ast',{start:0,end:8},[{dimension:'source',labelId:'piano',score:.99}]);const seek:number[]=[];render(<MusicFeatures node={n} onSeek={s=>seek.push(s)}/>);fireEvent.click(screen.getByText('Details'));expect(screen.queryByRole('button',{name:/^(Confirm|Reject|Unsure)$/})).not.toBeInTheDocument();fireEvent.click(screen.getByText(/Evidence for piano/));fireEvent.click(screen.getByRole('button',{name:/Listen for piano/}));expect(seek).toEqual([0]);
});

it('shows glass hit filename fallback without changing the node',()=>{const n=fixture();n.title='249196_glass_hit.wav';const before=JSON.stringify(n);render(<MusicFeatures node={n}/>);const summary=screen.getByRole('region',{name:'Sound identification'});expect(within(summary).getByText('glass hit')).toBeVisible();expect(within(summary).getByText(/From filename/)).toBeVisible();expect(JSON.stringify(n)).toBe(before);});
