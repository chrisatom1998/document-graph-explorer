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
  expect(screen.getByText(/uncalibrated/)).toBeVisible();
  expect(screen.getByText(/AST: failed/)).toBeVisible();
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
 expect(screen.getByText('CLAP “vocal chops” score 0.500 (supports voice)')).toBeInTheDocument();
 expect(screen.getByText('Raw model scores are not probabilities.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Listen for voice at 0:00–0:03'}));
 expect(seek).toHaveBeenCalledWith(0);
});
