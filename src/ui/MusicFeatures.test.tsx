// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DocNode } from '../model/types';
import MusicFeatures from './MusicFeatures';
import { createRecognition, recordEvidence } from '../audio/recognition';
import { useSettingsStore } from '../store/settingsStore';
import { useGraphStore } from '../store/graphStore';
function renderExpanded(ui: Parameters<typeof render>[0]) {
  const view = render(ui);
  const details = screen.queryByText('Technical details');
  if (details) fireEvent.click(details);
  fireEvent.click(screen.getByText('Track actions'));
  return view;
}
afterEach(() => { cleanup(); useSettingsStore.getState().setMusicAnalysisMode('full'); });
it.each([
  ['Bleacher_D#m_130.wav', 'D♯ minor', 'E♭ minor'],
  ['Clip_Ebm_130.wav', 'E♭ minor', 'D♯ minor'],
])('keeps the file name key spelling for %s when the audio agrees', (path, label, otherSpelling) => {
  const audio = { ...node.audio!, key: { tonic: 3, mode: 'minor' as const, strength: .8 }, tempo: { bpm: 130, confidence: .9 }, detectedPitch: { pitchClass: 3, confidence: .9 } };
  renderExpanded(<MusicFeatures node={{ ...node, path, audio }} />);
  expect(screen.getByText(label, { selector: 'dd' })).toBeVisible();
  expect(screen.queryByText(/^audio /, { selector: 'small' })).toBeNull();
  expect(screen.queryByText(new RegExp(otherSpelling))).toBeNull();
  expect(audio.key).toEqual({ tonic: 3, mode: 'minor', strength: .8 });
});
it('displays the filename D-sharp minor and marks the conflicting audio estimate', () => {
  render(<MusicFeatures node={{ ...node, path: 'SHADOW_UK1_Melodic_Loop_Bleacher_D#m_130.wav', audio: { ...node.audio!, key: { tonic: 4, mode: 'minor', strength: .8 } } }} />);
  expect(screen.getByText('D♯ minor', { selector: 'dd' })).toBeVisible();
  expect(screen.queryByText('E minor', { selector: 'dd' })).toBeNull();
  expect(screen.queryByText('E♭ minor', { selector: 'dd' })).toBeNull();
  expect(screen.getByText('audio E minor', { selector: 'small' })).toBeVisible();
});
it('shows the automatic synth label with uncertainty without requiring a confirmation', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, instruments: [{ label: 'synthesizer', score: 0.39, status: 'possible' }, { label: 'trumpet', score: 0.376, status: 'possible' }], instrumentPrediction: { label: 'synthesizer', score: 0.39, margin: 0.014 } } }} />);
  expect(screen.getByRole('heading', { name: 'Estimated instrument' })).toBeVisible();
  expect(screen.getByText('synthesizer', { selector: 'p' })).toBeVisible();
  expect(screen.getByText(/Automatically classified from the audio.*Uncertain/)).toBeVisible();
  expect(screen.queryByText('Confirmed by you. These instruments are used for connections.')).toBeNull();
});
it('clearly distinguishes confirmed instruments from model guesses', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, confirmedInstruments: ['synthesizer'] } }} />);
  expect(screen.getByText('synthesizer', { selector: '.sound-tag--confirmed > span:not(.sr-only):not(.sound-tag__mark)' })).toBeVisible();
  expect(screen.queryByText('trumpet', { selector: 'span' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Other model guesses' })).toBeNull();
});
it('updates the confirmed summary after a later rejection', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, confirmedInstruments: ['synthesizer', 'trumpet'], soundReviews: [{ labelId: 'synthesizer', dimension: 'source', decision: 'rejected', scope: 'track', at: '2026-10-03T00:00:00Z', evidenceRunId: 'run' }] } }} />);
  expect(screen.getByText('trumpet', { selector: '.sound-tag--confirmed > span:not(.sr-only):not(.sound-tag__mark)' })).toBeVisible();
  expect(screen.queryByText('synthesizer', { selector: '.sound-tag > span' })).toBeNull();
  expect(screen.queryByText('synthesizer', { selector: '.dj-tag-groups .chip' })).toBeNull();
  expect(screen.getByText('trumpet', { selector: '.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)' })).toBeVisible();
});
it('keeps name-derived instruments after an unsure machine-label review', () => {
  renderExpanded(<MusicFeatures node={{ ...node, path: 'Piano Loop.wav', audio: { ...node.audio!, soundReviews: [{ labelId: 'oboe', dimension: 'source', decision: 'uncertain', scope: 'track', at: '2026-10-03T00:00:00Z', evidenceRunId: 'run' }] } }} />);
  expect(within(screen.getByRole('region', { name: 'Sound identification' })).getByText('piano')).toBeVisible();
});
const node: DocNode = { id: 'track', kind: 'document', title: 'Track', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: 0, degree: 0, status: 'ok', audio: { version: 2, durationSeconds: 180, analyzedSeconds: 60, notes: [], instrumentScan: { complete: true, analyzedSeconds: 180, windows: 35 }, instruments: [{ label: 'trumpet', status: 'likely', score: .9, segments: [{ start: 70, end: 80, score: .9 }] }, { label: 'cello', status: 'possible', score: .5 }] } };
it('shows whole-track coverage and lets listeners verify the strongest instrument passage', () => {
  useGraphStore.getState().setPhase('ready');
  const seek = vi.fn();
  renderExpanded(<MusicFeatures node={node} onSeek={seek} />);
  expect(screen.getByText('Full-track instrument scan: 3:00 of 3:00.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Listen for trumpet at 1:10' }));
  expect(seek).toHaveBeenCalledWith(70);
  expect(screen.getByText('Possible instruments (1)')).toBeTruthy();
  expect(screen.getByText('Weaker detections. These do not create instrument links.')).toBeTruthy();
});

it('keeps other model guesses inside Technical details until it is opened', () => {
  const soundProfile = { version: 1 as const, character: [], roles: [], models: [], disagreement: false, djTags: [
    { group: 'production' as const, label: 'drum loop', score: .4 }, { group: 'character' as const, label: 'rhythmic_stabs', score: .4 },
  ] };
  render(<MusicFeatures node={{ ...node, audio: { ...node.audio!, soundProfile } }} />);
  const guesses = screen.getByRole('region', { name: 'Other model guesses' });
  expect(guesses).not.toBeVisible();
  expect(guesses.closest('details')).toBe(screen.getByText('Technical details').closest('details'));
  fireEvent.click(screen.getByText('Technical details'));
  expect(guesses).toBeVisible();
  expect(screen.getByText('drum loop', { selector: '.chip--guess' })).toBeVisible();
});

it('shows a weak synth suggestion immediately instead of claiming nothing was detected', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, instruments: [{ label: 'synthesizer', score: 0.115, status: 'possible' }] } }} />);
  expect(screen.getByRole('heading', { name: 'Suggested instruments' })).toBeTruthy();
  expect(screen.getByText('synthesizer', { selector: 'span' })).toBeVisible();
  expect(screen.getByText(/Low-confidence suggestions/)).toBeVisible();
  expect(screen.queryByText('None identified confidently.')).toBeNull();
});
it('explains the alternative tempo for a short clip', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, tempo: { bpm: 70, confidence: 0.75, alternatives: [140] } } }} />);
  expect(screen.getByText('70 BPM')).toBeVisible();
  expect(screen.getByText(/140.0 BPM may also fit at half or double time/)).toBeVisible();
});
it('shows the detected pitch without inventing a major or minor mode', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, detectedPitch: { pitchClass: 2, confidence: 0.94 } } }} />);
  expect(screen.getByText('Key')).toBeVisible();
  expect(screen.getByText(/Detected pitch: D/)).toBeVisible();
  expect(screen.getByText(/A repeated note alone cannot establish/)).toBeVisible();
});
it('shows name-derived features and marks the conflicting audio tempo', () => {
  renderExpanded(<MusicFeatures node={{ ...node, path: 'Synths/Action_Dm_140.wav', audio: { ...node.audio!, tempo: { bpm: 70, confidence: .75 } } }} />);
  expect(screen.getByText('140 BPM')).toBeVisible();
  expect(screen.getByText('D minor')).toBeVisible();
  expect(screen.getByText('audio 70', { selector: 'small' })).toBeVisible();
  expect(screen.queryByText('Key tonic from name')).toBeNull();
  expect(screen.queryByText(/Audio comparison/)).toBeNull();
  expect(screen.queryByText('View source names')).toBeNull();
  expect(screen.queryByText('Action_Dm_140')).toBeNull();
});
it('attributes the added music model instead of presenting it as a confirmed label', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, instruments: [], instrumentPrediction: { label: 'synthesizer', score: .56, margin: .2, model: 'MTG-Jamendo' } } }} />);
  expect(screen.getByText(/Music model: MTG-Jamendo/)).toBeVisible();
});

it('labels sampled coverage truthfully and keeps the analysis mode out of Track actions', () => {
  useGraphStore.getState().setPhase('ready');
  renderExpanded(<MusicFeatures node={{...node,audio:{...node.audio!,instrumentScan:{complete:true,mode:'fast',analyzedSeconds:30,windows:3}}}} />);
  expect(screen.queryByRole('combobox',{name:'Music analysis mode'})).toBeNull();
  expect(screen.getByText('Sampled instrument scan: 0:30 of 3:00.')).toBeVisible();
  expect(screen.queryByText(/Full-track instrument scan/)).toBeNull();
});
it('distinguishes active verification from an interrupted saved preview', () => {
  useGraphStore.getState().setPhase('parsing');
  const {rerender}=renderExpanded(<MusicFeatures node={{...node,audio:{...node.audio!,stage:'preview'}}} />);
  expect(screen.getByText(/Quick estimate — still checking/)).toBeVisible();
  useGraphStore.getState().setPhase('ready');
  rerender(<MusicFeatures node={{...node,audio:{...node.audio!,stage:'preview'}}} />);
  expect(screen.getByText(/Quick estimate only\. Reanalyze to finish/)).toBeVisible();
});

it('keeps explanations collapsed while showing the main musical values', () => {
  render(<MusicFeatures node={{ ...node, path: 'Synths/Action_Dm_140.wav' }} />);
  expect(screen.getByText('140 BPM')).toBeVisible();
  expect(screen.getByText('D minor')).toBeVisible();
  expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('button', { name: 'All sound attributes' })).not.toBeVisible();
  fireEvent.click(screen.getByText('Track actions'));
  expect(screen.getByRole('button', { name: 'Reanalyze musical features' })).toHaveTextContent('Reanalyze');
});

it.each(['source','character','vocal'] as const)('keeps saved labels while removing correction actions after a %s review',dimension=>{
 renderExpanded(<MusicFeatures node={{...node,audio:{...node.audio!,soundReviews:[{labelId:dimension==='source'?'oboe':dimension==='vocal'?'singing':'bright',dimension,decision:'confirmed',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'run'}]}}}/>);
 expect(screen.queryByText('Correct the instrument')).toBeNull();
});

it('does not show a rejected DJ source as confirmed in the summary or explanation',()=>{
 renderExpanded(<MusicFeatures node={{...node,path:'piano.wav',audio:{...node.audio!,confirmedDjTags:{source:['piano'],production:[],character:[]},soundProfile:{version:1,source:{label:'piano',basis:'Music CLAP',corroborated:false},character:[],roles:[],models:[],disagreement:false},soundReviews:[{labelId:'piano',dimension:'source',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'run'}]}}}/>);
 expect(screen.getByRole('region',{name:'Sound identification'})).not.toHaveTextContent('piano');
 expect(screen.queryByText('piano',{selector:'dd'})).toBeNull();
});

it('keeps duration, sound possibilities and corrections visible while diagnostics stay collapsed', () => {
  const recognition = createRecognition(180, 'full'); recognition.status = 'complete';
  recordEvidence(recognition, 'jamendo', { start: 10, end: 20 }, [{ dimension: 'source', labelId: 'oboe', score: .8 }]);
  render(<MusicFeatures node={{ ...node, audio: { ...node.audio!, recognition } }} />);
  expect(screen.getByText('3:00', { selector: 'dd' })).toBeVisible();
  // An untested model score never becomes a tested tag; it only appears in the separate, display-only "likely" group.
  expect(screen.queryByText('oboe', { selector: '.sound-tag:not(.sound-tag--likely-extra) > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)' })).toBeNull();
  expect(within(screen.getByRole('list',{name:'Likely, not yet tested'})).getByText('oboe')).toBeVisible();
  expect(screen.queryByText('Correct the instrument')).toBeNull();
  expect(screen.queryByText('Correct DJ tags')).toBeNull();
  expect(screen.getByText('Coverage by component')).not.toBeVisible();
  const disclosure = screen.getByText('Technical details');
  disclosure.focus(); expect(document.activeElement).toBe(disclosure);
  fireEvent.click(disclosure); expect(screen.getByText('Coverage by component')).toBeVisible();
});
it('preserves saved corrections across disclosure and rerender without offering review actions',()=>{
 const audio={...node.audio!,confirmedInstruments:['flute']};const before=structuredClone(audio);const view=render(<MusicFeatures node={{...node,audio}}/>);fireEvent.click(screen.getByText('Technical details'));fireEvent.click(screen.getByText('Technical details'));view.rerender(<MusicFeatures node={{...node,audio}}/>);expect(within(screen.getByRole('region',{name:'Sound identification'})).getByText('flute')).toBeVisible();expect(screen.queryByRole('button',{name:/^(Confirm|Reject|Unsure)$/})).toBeNull();expect(audio).toEqual(before);
});
it.each([.49,.5,.8])('hides the untested legacy prediction at score %s',score=>{
 render(<MusicFeatures node={{...node,audio:{...node.audio!,instruments:[],instrumentPrediction:{label:'synthesizer',score,margin:.01}}}}/>);
 expect(within(screen.getByRole('region',{name:'Sound identification'})).queryByText('synthesizer')).toBeNull();expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open');
});

it.each(['rejected','uncertain'] as const)('does not revive %s effect/character reviews in profile groups or correction defaults',decision=>{
 const audio={...node.audio!,confirmedDjTags:{source:['piano'],production:['riser'],character:['distorted']},soundProfile:{version:1 as const,character:['distorted'],roles:[],models:[],disagreement:false,djTags:[{group:'production' as const,label:'riser',score:.8},{group:'character' as const,label:'distorted',score:.8}]},soundReviews:[{dimension:'effect' as const,labelId:'riser',decision,scope:'track' as const,at:'2026-10-03T00:00:00Z',evidenceRunId:'old'},{dimension:'character' as const,labelId:'distorted',decision,scope:'track' as const,at:'2026-10-03T00:00:00Z',evidenceRunId:'old'}]};
 const before=structuredClone(audio);renderExpanded(<MusicFeatures node={{...node,audio}}/>);
 const attributes=screen.getByRole('region',{name:'All sound attributes'});
 for(const label of ['riser','distorted'])expect(within(attributes).getByText(label).closest('li')).toHaveTextContent(`${decision==='uncertain'?'unsure':decision} by you`);
 expect(screen.getByRole('region',{name:'Sound identification'})).not.toHaveTextContent(/riser|distorted/);
 expect(audio).toEqual(before);
});
it('updates profile confirmations and correction defaults on the latest review without modifying raw estimates',()=>{
 const audio={...node.audio!,soundProfile:{version:1 as const,character:['distorted'],roles:[],models:[],disagreement:false,djTags:[{group:'character' as const,label:'distorted',score:.8}]},soundReviews:[{dimension:'character' as const,labelId:'distorted',decision:'rejected' as const,scope:'track' as const,at:'2026-10-03T00:00:00Z',evidenceRunId:'old'}]};
 const view=renderExpanded(<MusicFeatures node={{...node,audio}}/>);
 expect(screen.getByRole('region',{name:'Sound identification'})).not.toHaveTextContent('distorted');
 const updated={...audio,soundReviews:[...audio.soundReviews,{...audio.soundReviews[0],decision:'confirmed' as const}]};
 view.rerender(<MusicFeatures node={{...node,audio:updated}}/>);
 expect(screen.queryByRole('region',{name:'Other model guesses'})).toBeNull(); // confirmed, so not repeated as a guess
 expect(screen.getByRole('region',{name:'Sound identification'})).toHaveTextContent(/distorted — Character · confirmed by you/);
 expect(updated.soundProfile.djTags[0].score).toBe(.8);expect(updated.soundReviews).toHaveLength(2);
});


it('keeps analysis limitations and retry details in Technical details', () => {
  const notes = ['Only the first 30 seconds could be analyzed.', 'Instrument model failed to load. Reanalyze to retry.'];
  render(<MusicFeatures node={{ ...node, audio: { ...node.audio!, notes } }} />);
  const details = screen.getByText('Technical details').closest('details')!;
  for (const note of notes) {
    expect(within(details).getByText(note)).not.toBeVisible();
  }
  fireEvent.click(screen.getByText('Technical details'));
  for (const note of notes) expect(within(details).getByText(note)).toBeVisible();
});
