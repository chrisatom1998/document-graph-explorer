// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import MainSoundAttributes, {likelyExtraSounds,setAttributesOpenSetting,setShowUnconfirmedSetting,soundAttributeRows} from './MainSoundAttributes';
import MusicFeatures from './MusicFeatures';
import type {MusicAnalysis} from '../audio/musicTypes';
import type {DocNode} from '../model/types';
import {createRecognition,recordEvidence} from '../audio/recognition';
import {FUSION_LABELS} from '../audio/fusion';
// Most tests inspect the expanded contents; the collapse itself has its own test below.
beforeEach(()=>{setAttributesOpenSetting(true);});
afterEach(()=>{cleanup();setShowUnconfirmedSetting(false);setAttributesOpenSetting(false);});
const audio=():MusicAnalysis=>({version:2,durationSeconds:8,analyzedSeconds:8,instruments:[],notes:[]});
it('attributes listening suggestions to audio excerpts without fabricating confidence',()=>{
 const a=audio();a.copilotProperties={model:'gpt-audio-1.5',audioExcerpt:{startSeconds:0,durationSeconds:8},tags:{source:['voice'],production:[],character:[]}};
 const row=soundAttributeRows(a,{title:'neutral.wav'}).find(row=>row.label==='voice');
 expect([...row!.evidence]).toEqual(['gpt-audio-1.5 audio-excerpt suggestion · unverified']);expect(row?.probabilityScore).toBeUndefined();
});
it('makes weak native labels, roles, voice styles, and all candidates visible without changing tags or data',()=>{
 const a=audio();a.recognition=createRecognition(8,'full');recordEvidence(a.recognition,'ast',{start:0,end:8},[{dimension:'source',labelId:'piano',score:.23}]);
 a.soundProfile={version:1,disagreement:true,character:['bright'],roles:['melody'],voice:{basis:'Music CLAP',style:'vocal chops',corroborated:false},models:[{model:'Music CLAP',complete:false,candidates:['piano','flute','violin','cello','guitar'].map(label=>({label,score:.2}))}]};
 const before=structuredClone(a);render(<MainSoundAttributes audio={a} node={{title:'neutral.wav'}}/>);fireEvent.click(screen.getByRole('button',{name:/Show unconfirmed/}));
 expect(screen.getByText('guitar')).toBeVisible();expect(screen.getByText('vocal chops')).toBeVisible();expect(screen.getByText('melody')).toBeVisible();expect(screen.getByText(/score range 0.230/)).toBeVisible();expect(screen.getByText(/models disagree/)).toBeVisible();expect(a).toEqual(before);
});
it.each(['rejected','uncertain'] as const)('keeps %s labels explicitly subordinate to the saved review',decision=>{
 const a=audio();a.instruments=[{label:'piano',score:.9}];a.soundReviews=[{dimension:'source',labelId:'piano',decision,scope:'track',at:'now',evidenceRunId:'qa'}];
 const row=soundAttributeRows(a,{title:'piano.wav'}).find(x=>x.label==='piano');expect(row?.review).toBe(`${decision==='uncertain'?'unsure':decision} by you`);
});
it('marks stale estimates superseded by explicit empty corrections',()=>{
 const a=audio();a.confirmedDjTags={source:[],production:[],character:[]};a.instruments=[{label:'piano',score:.9}];
 expect(soundAttributeRows(a,{title:'piano.wav'})[0].review).toBe('superseded by your source corrections');
});
it('preserves a rejected voice source on its dependent style',()=>{
 const a=audio();a.soundProfile={version:1,character:[],roles:[],models:[],disagreement:false,voice:{basis:'Music CLAP',style:'vocal chops',corroborated:false}};
 a.soundReviews=[{dimension:'source',labelId:'voice',decision:'rejected',scope:'track',at:'now',evidenceRunId:'qa'}];
 expect(soundAttributeRows(a,{title:'neutral.wav'}).find(row=>row.dimension==='vocal')?.review).toBe('voice rejected by you');
});
it('keeps filename measurements separate from audio and exposes alternatives and pitch confidence',()=>{
 const a=audio();a.tempo={bpm:90,confidence:.3,alternatives:[180]};a.key={tonic:2,mode:'minor',strength:.7};a.detectedPitch={pitchClass:2,confidence:.8};
 render(<MainSoundAttributes audio={a} node={{title:'piano_120BPM_Cminor.wav'}}/>);
 expect(screen.getByText(/90 BPM · confidence 0.300 · alternatives 180/)).toBeVisible();expect(screen.getByText('120 BPM · not audio evidence')).toBeVisible();expect(screen.getByText(/D minor · strength 0.700/)).toBeVisible();expect(screen.getByText(/confidence 0.800/)).toBeVisible();
});
it('shows a brief incomplete warning instead of component diagnostics',()=>{
 const a=audio();a.recognition=createRecognition(8,'full');a.recognition.jobs[0].status='unsupported';a.recognition.jobs[0].unsupportedReason='Input too short';
 render(<MainSoundAttributes audio={a} node={{title:'neutral.wav'}}/>);expect(screen.getByText('Some audio analysis is incomplete or unavailable.')).toBeVisible();expect(screen.queryByText(/ast: unsupported/)).toBeNull();expect(screen.getByText(/Source: unknown or unsupported/)).toBeVisible();
});
it('keeps the attributes inside the collapsed Technical details in the actual music panel',()=>{
 const a=audio();a.instruments=[{label:'piano',score:.22,status:'possible'}];
 const node:DocNode={id:'qa',kind:'document',fileType:'audio',title:'neutral.wav',topics:[],entities:[],keywords:[],wordCount:0,cluster:0,degree:0,status:'ok',audio:a};
 render(<MusicFeatures node={node}/>);const region=screen.getByRole('region',{name:'All sound attributes'});
 expect(region.closest('details')).not.toBeNull();expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');
 fireEvent.click(screen.getByText('Technical details'));fireEvent.click(screen.getByRole('button',{name:/Show unconfirmed/}));
 expect(within(region).getByText('piano')).toBeVisible();expect(screen.queryByRole('button',{name:/^(Confirm|Reject|Unsure)$/})).toBeNull();
});
it('exposes experimental classifier states without promoting them to verified labels',()=>{
 const a=audio();a.durationSeconds=10;a.fusion={version:1,scope:'window',validation:'unvalidated',identity:{modelSha256:'a'.repeat(64),policySha256:'b'.repeat(64),scorerSha256:'c'.repeat(64)},planned:1,counts:{complete:1,failed:0,unsupported:0,empty:0},omittedWindows:0,windows:[{start:0,end:10,status:'complete',decisions:FUSION_LABELS.map(label=>({label,state:'uncertain',source:'learned-head',headProbability:.2,decisionProbability:.2,eligible:false,positiveGroups:2,negativeGroups:2}))}]};
 const rows=soundAttributeRows(a,{title:'neutral.wav'});expect(rows).toHaveLength(20);expect([...rows[0].evidence][0]).toContain('Experimental, disabled classifier · uncertain');expect([...rows[0].evidence][0]).toContain('head not enabled');
});

it('hides coverage and model-status counts while retaining sound labels and scores',()=>{
 const a=audio();a.recognition=createRecognition(8,'full');a.recognition.status='complete';for(const job of a.recognition.jobs)job.status='complete';a.instrumentScan={complete:true,analyzedSeconds:8,windows:1,mode:'full'};a.soundProfile={version:1,character:[],roles:[],disagreement:false,models:[{model:'Music CLAP',complete:true,candidates:[{label:'piano',score:.7}]}]};const before=structuredClone(a);
 render(<MainSoundAttributes audio={a} node={{title:'neutral.wav'}}/>);expect(screen.getByText('piano')).toBeVisible();expect(screen.getByText(/score 0.700/)).toBeVisible();expect(screen.queryByText('Analysis coverage and limits')).toBeNull();expect(screen.queryByText(/Audio analysis:|saved candidates|s of excerpts|Instrument scan:|ast: complete/)).toBeNull();expect(screen.queryByRole('status')).toBeNull();expect(a).toEqual(before);
});

it('folds unconfirmed evidence behind a toggle while keeping reviewed labels visible',()=>{
 const a=audio();a.instruments=[{label:'piano',score:.9}];a.soundProfile={version:1,character:['bright'],roles:[],models:[],disagreement:false};a.soundReviews=[{dimension:'source',labelId:'piano',decision:'confirmed',scope:'track',at:'now',evidenceRunId:'qa'}];
 render(<MainSoundAttributes audio={a} node={{title:'neutral.wav'}}/>);
 expect(screen.getByText('piano')).toBeVisible();expect(screen.queryByText('bright')).toBeNull();
 const box=screen.getByRole('button',{name:'Show unconfirmed (1)'});expect(box).toHaveAttribute('aria-pressed','false');
 fireEvent.click(box);expect(screen.getByText('bright')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Hide unconfirmed (1)'}));expect(screen.queryByText('bright')).toBeNull();
});

it('lists unreviewed labels scored 50% or higher as likely and folds weaker ones',()=>{
 const a=audio();a.soundProfile={version:1,character:[],roles:[],disagreement:false,models:[{model:'Music CLAP',complete:true,candidates:[{label:'bright',score:.62},{label:'warm',score:.31}]}]};
 render(<MainSoundAttributes audio={a} node={{title:'neutral.wav'}}/>);
 expect(screen.getByText('bright')).toBeVisible();expect(screen.getByText(/likely · model score ≥ 50%/)).toBeVisible();expect(screen.queryByText('warm')).toBeNull();
 expect(screen.getByRole('button',{name:'Show unconfirmed (1)'})).toBeVisible();
});

it('keeps the show-unconfirmed choice when the panel remounts',()=>{
 const a=audio();a.soundProfile={version:1,character:['warm'],roles:[],disagreement:false,models:[]};
 const first=render(<MainSoundAttributes audio={a} node={{title:'neutral.wav'}}/>);
 fireEvent.click(screen.getByRole('button',{name:/Show unconfirmed/}));expect(screen.getByText('warm')).toBeVisible();
 first.unmount();
 render(<MainSoundAttributes audio={a} node={{title:'other.wav'}}/>);
 expect(screen.getByText('warm')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Hide unconfirmed/}));
});
it('starts collapsed and keeps the open choice when another sound is shown',()=>{
 setAttributesOpenSetting(false);
 const a=audio();a.instruments=[{label:'piano',score:.9}];
 const view=render(<MainSoundAttributes audio={a} node={{title:'one.wav'}}/>);
 const toggle=screen.getByRole('button',{name:'All sound attributes'});
 expect(toggle).toHaveAttribute('aria-expanded','false');expect(screen.getByText('piano')).not.toBeVisible();
 fireEvent.click(toggle);expect(toggle).toHaveAttribute('aria-expanded','true');expect(screen.getByText('piano')).toBeVisible();
 view.unmount();render(<MainSoundAttributes audio={a} node={{title:'two.wav'}}/>);
 expect(screen.getByRole('button',{name:'All sound attributes'})).toHaveAttribute('aria-expanded','true');
});
it('offers only probability-like, unreviewed scores of 0.5+ as likely extras',()=>{
 const a=audio();a.recognition=createRecognition(8,'full');
 recordEvidence(a.recognition,'jamendo',{start:0,end:8},[{dimension:'source',labelId:'oboe',score:.8}]);
 recordEvidence(a.recognition,'clap',{start:0,end:8},[{dimension:'source',labelId:'flute',score:.9}]);
 recordEvidence(a.recognition,'ast',{start:0,end:8},[{dimension:'source',labelId:'piano',score:.7},{dimension:'source',labelId:'cello',score:.3}]);
 a.soundReviews=[{dimension:'source',labelId:'piano',decision:'rejected',scope:'track',at:'now',evidenceRunId:'qa'}];
 const labels=likelyExtraSounds(a,{title:'neutral.wav'},new Set()).map(r=>r.label);
 expect(labels).toEqual(['oboe']); // CLAP similarity, reviewed labels and weak scores never count
 expect(likelyExtraSounds(a,{title:'neutral.wav'},new Set(['oboe']))).toEqual([]);
});
