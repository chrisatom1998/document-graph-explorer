// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRecognition, recordEvidence } from '../audio/recognition';
import RecognitionEvidence from './RecognitionEvidence';
afterEach(cleanup);
it('shows simultaneous possible sources, window playback, uncertainty and component coverage', () => {
  const run=createRecognition(20,'full'); run.jobs[0].status='failed'; run.jobs[0].error='missing weights';
  recordEvidence(run,'jamendo',{start:10,end:20},[{dimension:'source',labelId:'oboe',score:.8},{dimension:'source',labelId:'viola',score:.7}]);
  const seek=vi.fn(); render(<RecognitionEvidence recognition={run} duration={20} onSeek={seek} />);
  expect(screen.getByText('oboe')).toBeVisible(); expect(screen.getByText('viola')).toBeVisible();
  expect(screen.getByText(/uncalibrated/)).not.toBeVisible();
  fireEvent.click(screen.getByText('Details'));
  expect(screen.getByText(/uncalibrated/)).toBeVisible();
  expect(screen.getByText(/AST: failed/)).toBeVisible();
  fireEvent.click(screen.getByText('Evidence for oboe (1 windows)'));
  fireEvent.click(screen.getByRole('button',{name:'Listen for oboe at 0:10–0:20'}));
  expect(seek).toHaveBeenCalledWith(10);
  expect(screen.getByText(/Vocal form: unknown/)).toBeVisible();
});
it('shows saved review scope and keeps a human decision distinct from a fresh suggestion',()=>{
  const run=createRecognition(10,'full');
  recordEvidence(run,'jamendo',{start:0,end:10},[{dimension:'source',labelId:'oboe',score:.8}]);
  const review=vi.fn();
  render(<RecognitionEvidence recognition={run} duration={10} onReview={review} reviews={[{dimension:'source',labelId:'oboe',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'earlier'}]} />);
  expect(screen.getByText(/Your review for this track: rejected. Evidence has changed/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  expect(review).toHaveBeenCalledWith('oboe','source','confirmed');
});
it('keeps dropped labels reviewable so obsolete confirmations can be rejected',()=>{
  const run=createRecognition(10,'full');const review=vi.fn();
  render(<RecognitionEvidence recognition={run} duration={10} onReview={review} reviews={[{dimension:'source',labelId:'oboe',decision:'confirmed',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'earlier'}]} />);
  expect(screen.getByText('— no current machine evidence')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Reject'}));
  expect(review).toHaveBeenCalledWith('oboe','source','rejected');
});

it('explains the qualifying vocal prompt instead of presenting its score as direct voice confidence',()=>{
 const run=createRecognition(3,'full');
 recordEvidence(run,'clap',{start:0,end:3},[{dimension:'source',labelId:'voice',score:.5,derivedFrom:{group:'sample',labelId:'vocal chops'}}]);
 const seek=vi.fn();render(<RecognitionEvidence recognition={run} duration={3} onSeek={seek}/>);
 expect(screen.getByText('voice')).toBeVisible();
 fireEvent.click(screen.getByText('Details'));
 fireEvent.click(screen.getByText('Evidence for voice (1 windows)'));
 expect(screen.getByText('CLAP “vocal chops” score 0.500 (supports voice)')).toBeInTheDocument();
 expect(screen.getByText('Raw model scores are not probabilities.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Listen for voice at 0:00–0:03'}));
 expect(seek).toHaveBeenCalledWith(0);
});

it('names each group of repeated review controls',()=>{
 const run=createRecognition(10,'full');
 recordEvidence(run,'jamendo',{start:0,end:10},[{dimension:'source',labelId:'piano',score:.8},{dimension:'source',labelId:'guitar',score:.8}]);
 render(<RecognitionEvidence recognition={run} duration={10}/>);
 expect(screen.getByRole('group',{name:'Review piano for this track'})).toBeVisible();
 expect(screen.getByRole('group',{name:'Review guitar for this track'})).toBeVisible();
});

it('keeps analysis failure and incomplete evidence visible outside diagnostic details',()=>{
  const recognition=createRecognition(10,'full'); recognition.status='failed'; recognition.truncated=true;
  render(<RecognitionEvidence recognition={recognition} duration={10}/>);
  expect(screen.getByText('Analysis: failed.')).toBeVisible();
  expect(screen.getByText('Evidence incomplete.')).toBeVisible();
  expect(screen.getByText('Coverage by component')).not.toBeVisible();
});
it('keeps uncertainty and every named review action accessible without opening details',()=>{
  const recognition=createRecognition(10,'full'); const review=vi.fn();
  recordEvidence(recognition,'jamendo',{start:0,end:10},[{dimension:'source',labelId:'flute',score:.8}]);
  render(<RecognitionEvidence recognition={recognition} duration={10} onReview={review}/>);
  expect(screen.getByText('— possible')).toBeVisible();
  const group=screen.getByRole('group',{name:'Review flute for this track'});
  expect(group).toBeVisible();
  for(const name of ['Confirm','Reject','Unsure']) fireEvent.click(screen.getByRole('button',{name}));
  expect(review.mock.calls).toEqual([['flute','source','confirmed'],['flute','source','rejected'],['flute','source','uncertain']]);
});

it('retains a concise availability warning when a completed run has a failed component',()=>{
  const recognition=createRecognition(10,'full'); recognition.status='complete'; recognition.jobs[0].status='failed';
  render(<RecognitionEvidence recognition={recognition} duration={10}/>);
  expect(screen.getByText('Some analysis is unavailable.')).toBeVisible();
  expect(screen.getByText(/AST: failed/)).not.toBeVisible();
});
