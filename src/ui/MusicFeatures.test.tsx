// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocNode } from '../model/types';
import MusicFeatures from './MusicFeatures';
import { createRecognition, recordEvidence } from '../audio/recognition';
import { useSettingsStore } from '../store/settingsStore';
import { useGraphStore } from '../store/graphStore';
function renderExpanded(ui: Parameters<typeof render>[0]) {
  const view = render(ui);
  const details = screen.queryByText('Details');
  if (details) fireEvent.click(details);
  fireEvent.click(screen.getByText('Track actions'));
  return view;
}
afterEach(() => { cleanup(); useSettingsStore.getState().setMusicAnalysisMode('full'); });
it.each([
  ['Bleacher_D#m_130.wav', 'D♯ minor', 'D♯', 'E♭ minor'],
  ['Clip_Ebm_130.wav', 'E♭ minor', 'E♭', 'D♯ minor'],
])('keeps equivalent key spelling consistent throughout explanations for %s', (path, label, pitch, otherSpelling) => {
  const audio = { ...node.audio!, key: { tonic: 3, mode: 'minor' as const, strength: .8 }, tempo: { bpm: 130, confidence: .9 }, detectedPitch: { pitchClass: 3, confidence: .9 } };
  renderExpanded(<MusicFeatures node={{ ...node, path, audio }} />);
  fireEvent.click(screen.getByText('View source names'));
  expect(screen.getByText(`Filename — ${label} · 130 BPM`)).toBeVisible();
  expect(screen.getByText(`Audio comparison: tempo 130.0 BPM; key ${label}; detected pitch ${pitch}.`)).toBeVisible();
  expect(screen.queryByText(new RegExp(otherSpelling))).toBeNull();
  expect(screen.queryByText(/Differences may reflect/)).toBeNull();
  expect(audio.key).toEqual({ tonic: 3, mode: 'minor', strength: .8 });
});
it('displays the filename D-sharp minor instead of a conflicting audio estimate or E-flat spelling', () => {
  render(<MusicFeatures node={{ ...node, path: 'SHADOW_UK1_Melodic_Loop_Bleacher_D#m_130.wav', audio: { ...node.audio!, key: { tonic: 4, mode: 'minor', strength: .8 } } }} />);
  expect(screen.getByText('D♯ minor', { selector: 'dd' })).toBeVisible();
  expect(screen.queryByText('E minor', { selector: 'dd' })).toBeNull();
  expect(screen.queryByText('E♭ minor', { selector: 'dd' })).toBeNull();
  fireEvent.click(screen.getByText('Details'));
  expect(screen.getByText(/Audio comparison:.*key E minor/)).toBeVisible();
});
it('shows the automatic synth label with uncertainty without requiring a confirmation', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, instruments: [{ label: 'synthesizer', score: 0.39, status: 'possible' }, { label: 'trumpet', score: 0.376, status: 'possible' }], instrumentPrediction: { label: 'synthesizer', score: 0.39, margin: 0.014 } } }} />);
  expect(screen.getByRole('heading', { name: 'Estimated instrument' })).toBeVisible();
  expect(screen.getByText('synthesizer', { selector: 'p' })).toBeVisible();
  expect(screen.getByText(/Automatically classified from the audio.*Uncertain/)).toBeVisible();
  expect(screen.queryByText('Confirmed instruments')).toBeNull();
});
it('clearly distinguishes confirmed instruments from model guesses', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, confirmedInstruments: ['synthesizer'] } }} />);
  expect(screen.getByRole('heading', { name: 'Confirmed instruments' })).toBeVisible();
  expect(screen.getByText('synthesizer', { selector: 'li' })).toBeVisible();
  expect(screen.queryByText('trumpet', { selector: 'span' })).toBeNull();
  expect(screen.getByText('Confirmed by you. These instruments are used for connections.')).toBeVisible();
});
it('updates the confirmed summary after a later rejection', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, confirmedInstruments: ['synthesizer', 'trumpet'], soundReviews: [{ labelId: 'synthesizer', dimension: 'source', decision: 'rejected', scope: 'track', at: '2026-10-03T00:00:00Z', evidenceRunId: 'run' }] } }} />);
  expect(screen.getByRole('heading', { name: 'Confirmed instruments' })).toBeVisible();
  expect(screen.getByText('trumpet', { selector: 'li' })).toBeVisible();
  expect(screen.queryByText('synthesizer', { selector: 'li' })).toBeNull();
  expect(screen.getByText('trumpet', { selector: 'strong' })).toBeVisible();
});
it('keeps name-derived instruments after an unsure machine-label review', () => {
  renderExpanded(<MusicFeatures node={{ ...node, path: 'Piano Loop.wav', audio: { ...node.audio!, soundReviews: [{ labelId: 'oboe', dimension: 'source', decision: 'uncertain', scope: 'track', at: '2026-10-03T00:00:00Z', evidenceRunId: 'run' }] } }} />);
  expect(screen.getByText('Instruments from name')).toBeVisible();
  expect(screen.getAllByText('piano').length).toBeGreaterThan(0);
  expect(screen.queryByText('Confirmed instruments')).toBeNull();
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

it('shows a weak synth suggestion immediately instead of claiming nothing was detected', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, instruments: [{ label: 'synthesizer', score: 0.115, status: 'possible' }] } }} />);
  expect(screen.getByRole('heading', { name: 'Suggested instruments' })).toBeTruthy();
  expect(screen.getByText('synthesizer', { selector: 'span' })).toBeVisible();
  expect(screen.getByText(/Low-confidence suggestions/)).toBeVisible();
  expect(screen.queryByText('None identified confidently.')).toBeNull();
});
it('explains the alternative tempo for a short clip', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, tempo: { bpm: 70, confidence: 0.75, alternatives: [140] } } }} />);
  expect(screen.getByText('70.0 BPM')).toBeVisible();
  expect(screen.getByText(/140.0 BPM may also fit at half or double time/)).toBeVisible();
});
it('shows the detected pitch without inventing a major or minor mode', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, detectedPitch: { pitchClass: 2, confidence: 0.94 } } }} />);
  expect(screen.getByText('Estimated key')).toBeVisible();
  expect(screen.getByText(/Detected pitch: D/)).toBeVisible();
  expect(screen.getByText(/A repeated note alone cannot establish/)).toBeVisible();
});
it('shows name-derived features and retains conflicting audio for comparison', () => {
  renderExpanded(<MusicFeatures node={{ ...node, path: 'Synths/Action_Dm_140.wav', audio: { ...node.audio!, tempo: { bpm: 70, confidence: .75 } } }} />);
  expect(screen.getByText('140.0 BPM')).toBeVisible();
  expect(screen.getByText('D minor')).toBeVisible();
  expect(screen.queryByText('Key tonic from name')).toBeNull();
  expect(screen.getByText('Instruments from name')).toBeVisible();
  expect(screen.getByText(/Audio comparison: tempo 70.0 BPM/)).toBeVisible();
  expect(screen.getByText('From filename: D minor · 140 BPM')).toBeVisible();
  expect(screen.getByText('From folder: synthesizer')).toBeVisible();
  const sources = screen.getByText('View source names').closest('details')!;
  expect(sources).not.toHaveAttribute('open');
  expect(screen.getAllByText('Action_Dm_140')).toHaveLength(1);
  fireEvent.click(screen.getByText('View source names'));
  expect(sources).toHaveAttribute('open');
  expect(screen.getByText('Synths')).toBeVisible();
});
it('attributes the added music model instead of presenting it as a confirmed label', () => {
  renderExpanded(<MusicFeatures node={{ ...node, audio: { ...node.audio!, instruments: [], instrumentPrediction: { label: 'synthesizer', score: .56, margin: .2, model: 'MTG-Jamendo' } } }} />);
  expect(screen.getByText(/Music model: MTG-Jamendo/)).toBeVisible();
  expect(screen.queryByText('Confirmed instruments')).toBeNull();
});

it('selects the persistent analysis mode and labels sampled coverage truthfully', () => {
  useGraphStore.getState().setPhase('ready');
  renderExpanded(<MusicFeatures node={{...node,audio:{...node.audio!,instrumentScan:{complete:true,mode:'fast',analyzedSeconds:30,windows:3}}}} />);
  const mode=screen.getByRole('combobox',{name:'Music analysis mode'});
  expect(mode).toHaveValue('full');fireEvent.change(mode,{target:{value:'fast'}});
  expect(useSettingsStore.getState().musicAnalysisMode).toBe('fast');
  expect(screen.getByText('Sampled instrument scan: 0:30 of 3:00.')).toBeVisible();
  expect(screen.queryByText(/Full-track instrument scan/)).toBeNull();
});
it('distinguishes active verification from an interrupted saved preview', () => {
  useGraphStore.getState().setPhase('parsing');
  const {rerender}=renderExpanded(<MusicFeatures node={{...node,audio:{...node.audio!,stage:'preview'}}} />);
  expect(screen.getByText(/Quick estimate — verification is continuing/)).toBeVisible();
  useGraphStore.getState().setPhase('ready');
  rerender(<MusicFeatures node={{...node,audio:{...node.audio!,stage:'preview'}}} />);
  expect(screen.getByText(/Quick estimate only — verification is unfinished/)).toBeVisible();
});

it('keeps explanations collapsed while showing the main musical values', () => {
  render(<MusicFeatures node={{ ...node, path: 'Synths/Action_Dm_140.wav' }} />);
  expect(screen.getByText('140.0 BPM')).toBeVisible();
  expect(screen.getByText('D minor')).toBeVisible();
  expect(screen.getByText('Details').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Audio comparison:', { exact: false })).not.toBeVisible();
  fireEvent.click(screen.getByText('Track actions'));
  expect(screen.getByRole('combobox', { name: 'Music analysis mode' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reanalyze musical features' })).toHaveTextContent('Reanalyze');
});

it.each(['source','character','vocal'] as const)('keeps missing instruments correctable after a %s review',dimension=>{
 renderExpanded(<MusicFeatures node={{...node,audio:{...node.audio!,soundReviews:[{labelId:dimension==='source'?'oboe':dimension==='vocal'?'singing':'bright',dimension,decision:'confirmed',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'run'}]}}}/>);
 expect(screen.getByText('Correct the instrument')).toBeVisible();
});

it('does not show a rejected DJ source as confirmed in the summary or explanation',()=>{
 renderExpanded(<MusicFeatures node={{...node,path:'piano.wav',audio:{...node.audio!,confirmedDjTags:{source:['piano'],production:[],character:[]},soundProfile:{version:1,source:{label:'piano',basis:'Music CLAP',corroborated:false},character:[],roles:[],models:[],disagreement:false},soundReviews:[{labelId:'piano',dimension:'source',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'run'}]}}}/>);
 expect(screen.getByRole('region',{name:'Combined sound identification'})).not.toHaveTextContent('piano');
 expect(screen.queryByText('piano',{selector:'dd'})).toBeNull();
});

it('keeps duration, sound possibilities and corrections visible while diagnostics stay collapsed', () => {
  const recognition = createRecognition(180, 'full'); recognition.status = 'complete';
  recordEvidence(recognition, 'jamendo', { start: 10, end: 20 }, [{ dimension: 'source', labelId: 'oboe', score: .8 }]);
  render(<MusicFeatures node={{ ...node, audio: { ...node.audio!, recognition } }} />);
  expect(screen.getByText('3:00', { selector: 'dd' })).toBeVisible();
  expect(screen.getByText('oboe', { selector: 'strong' })).toBeVisible();
  expect(screen.getByText('— possible')).toBeVisible();
  expect(screen.getByText('Correct the instrument')).toBeVisible();
  expect(screen.getByText('Correct DJ tags')).toBeVisible();
  expect(screen.getByText('Coverage by component')).not.toBeVisible();
  expect(screen.getByText(/Suggestions are uncalibrated/)).not.toBeVisible();
  const disclosure = screen.getByText('Details');
  disclosure.focus(); expect(document.activeElement).toBe(disclosure);
  fireEvent.click(disclosure); expect(screen.getByText('Coverage by component')).toBeVisible();
});
it('retains correction drafts across details disclosure and same-node rerender', () => {
  const view = render(<MusicFeatures node={node} />);
  fireEvent.click(screen.getByText('Correct the instrument'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Known instrument' }), { target: { value: 'flute' } });
  fireEvent.click(screen.getByText('Correct DJ tags'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'reese' } });
  fireEvent.click(screen.getByText('Details')); fireEvent.click(screen.getByText('Details'));
  view.rerender(<MusicFeatures node={{ ...node }} />);
  expect(screen.getByRole('combobox', { name: 'Known instrument' })).toHaveValue('flute');
  expect(screen.getByRole('searchbox')).toHaveValue('reese');
});

// These qualifications remain visible while the technical Details disclosure is closed.
it.each([
  ['Estimated instrument · uncertain', { ...node, audio: { ...node.audio!, instrumentPrediction: { label: 'synthesizer', score: .39, margin: .014 } } }],
  ['Estimated instrument · possible', { ...node, audio: { ...node.audio!, instrumentPrediction: { label: 'synthesizer', score: .8, margin: .2 } } }],
  ['Likely instruments', node],
  ['Instrument · from name', { ...node, path: 'Piano Loop.wav' }],
  ['Instrument · confirmed by you', { ...node, audio: { ...node.audio!, confirmedInstruments: ['synthesizer'] } }],
])('keeps the %s qualification in the compact summary', (qualification, fixture) => {
  render(<MusicFeatures node={fixture as DocNode} />);
  expect(screen.getByText(qualification, { selector: '.music-source-summary span' })).toBeVisible();
  expect(screen.getByText('Details').closest('details')).not.toHaveAttribute('open');
});

it.each([
  ['From name', { path: 'Piano Loop.wav' }],
  ['Confirmed by you', { audio: { ...node.audio!, confirmedInstruments: ['piano'] } }],
  ['Possible · uncertain', {}],
])('qualifies the combined sound summary as %s outside Details', (qualification, overrides) => {
  const fixture = { ...node, ...overrides, audio: { ...node.audio!, ...('audio' in overrides ? overrides.audio : {}), soundProfile: { version: 1 as const, source: { label: 'piano', basis: 'Music CLAP' as const, corroborated: false }, character: [], roles: [], models: [], disagreement: true } } };
  render(<MusicFeatures node={fixture} />);
  expect(screen.getByText(qualification, { selector: '.chip' })).toBeVisible();
  expect(screen.getByText('Details').closest('details')).not.toHaveAttribute('open');
});
