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
  expect(screen.queryByText('oboe',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull(); expect(screen.queryByText('viola',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull();
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
  expect(screen.queryByText('oboe',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull();expect(screen.queryByRole('button',{name:'Confirm'})).toBeNull();expect(review).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Details'));fireEvent.click(screen.getByText('Saved review history (1)'));expect(screen.getByText(/oboe: rejected/)).toBeVisible();
});
it('retains saved confirmations without offering review controls',()=>{
  const run=createRecognition(10,'full');const review=vi.fn();
  render(<RecognitionEvidence recognition={run} duration={10} onReview={review} reviews={[{dimension:'source',labelId:'oboe',decision:'confirmed',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:'earlier'}]} />);
  expect(screen.getByText('oboe',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeVisible();expect(document.querySelector('.sound-tag--confirmed')).toHaveTextContent(/confirmed by you/);expect(screen.queryByRole('button',{name:'Reject'})).toBeNull();expect(review).not.toHaveBeenCalled();
});

it('explains the qualifying vocal prompt instead of presenting its score as direct voice confidence',()=>{
 const run=createRecognition(3,'full');
 recordEvidence(run,'clap',{start:0,end:3},[{dimension:'source',labelId:'voice',score:.5,derivedFrom:{group:'sample',labelId:'vocal chops'}}]);
 const seek=vi.fn();render(<RecognitionEvidence recognition={run} duration={3} onSeek={seek}/>);
 expect(screen.queryByText('voice',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull();
 fireEvent.click(screen.getByText('Details'));
 fireEvent.click(screen.getByText('Evidence for voice (1 windows)'));
 expect(screen.getByText('CLAP “vocal chops” score 0.500 (supports voice)')).toBeInTheDocument();
 expect(screen.getByText('Raw model scores are not probabilities.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Listen for voice at 0:00–0:03'}));
 expect(seek).toHaveBeenCalledWith(0);
});

it('removes every repeated review control group',()=>{
 const run=createRecognition(10,'full');
 recordEvidence(run,'jamendo',{start:0,end:10},[{dimension:'source',labelId:'cello',score:.8},{dimension:'source',labelId:'guitar',score:.8}]);
 render(<RecognitionEvidence recognition={run} duration={10}/>);
 expect(screen.queryByRole('group',{name:'Review cello for this track'})).toBeNull();expect(screen.queryByRole('group',{name:'Review guitar for this track'})).toBeNull();expect(screen.queryByText('cello',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull();expect(screen.queryByText('guitar',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull();
});

it('keeps analysis failure and incomplete evidence visible outside diagnostic details',()=>{
  const recognition=createRecognition(10,'full'); recognition.status='failed'; recognition.truncated=true;
  render(<RecognitionEvidence recognition={recognition} duration={10}/>);
  expect(screen.getByText('Analysis: failed.')).toBeVisible();
  expect(screen.getByText('Evidence incomplete.')).toBeVisible();
  expect(screen.getByText('Coverage by component')).not.toBeVisible();
});
it('hides untested estimates without review actions',()=>{
  const recognition=createRecognition(10,'full'); const review=vi.fn();
  recordEvidence(recognition,'jamendo',{start:0,end:10},[{dimension:'source',labelId:'flute',score:.8}]);
  render(<RecognitionEvidence recognition={recognition} duration={10} onReview={review}/>);
  expect(screen.queryByText('flute',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull();expect(screen.queryByRole('group',{name:'Review flute for this track'})).toBeNull();expect(screen.queryByRole('button',{name:/^(Confirm|Reject|Unsure)$/})).toBeNull();expect(review).not.toHaveBeenCalled();
});

it('retains a concise availability warning when a completed run has a failed component',()=>{
  const recognition=createRecognition(10,'full'); recognition.status='complete'; recognition.jobs[0].status='failed';
  render(<RecognitionEvidence recognition={recognition} duration={10}/>);
  expect(screen.getByText('Some analysis is unavailable.')).toBeVisible();
  expect(screen.getByText(/AST: failed/)).not.toBeVisible();
});

it('shows the latest effect review as the displayed state, retaining machine evidence underneath',()=>{
 const run=createRecognition(8,'full');recordEvidence(run,'clap',{start:1,end:3},[{dimension:'effect',labelId:'riser',score:.7}]);
 render(<RecognitionEvidence recognition={run} duration={8} reviews={[{dimension:'effect',labelId:'riser',decision:'rejected',scope:'track',at:'2026-10-03T00:00:00Z',evidenceRunId:run.runId}]} />);
 expect(screen.queryByText('— rejected by you')).not.toBeInTheDocument();expect(screen.queryByText('— model estimate',{exact:false})).not.toBeInTheDocument();
 expect(screen.queryByText('— possible')).not.toBeInTheDocument();
});

it.each(['effect','character'] as const)('review: %s latest append wins even after evidence changes',dimension=>{
 const run=createRecognition(8,'full');const labelId=dimension==='effect'?'riser':'distorted';
 recordEvidence(run,'clap',{start:1,end:3},[{dimension,labelId,score:.7}]);
 const base={dimension,labelId,scope:'track' as const,at:'2026-10-03T00:00:00Z',evidenceRunId:'previous-run'};
 const {rerender}=render(<RecognitionEvidence recognition={run} duration={8} reviews={[{...base,decision:'confirmed'},{...base,decision:'rejected'}]} />);
 expect(screen.queryByText('— rejected by you')).not.toBeInTheDocument();expect(screen.queryByText('— model estimate',{exact:false})).not.toBeInTheDocument();
 expect(screen.queryByText('— possible')).not.toBeInTheDocument();
 rerender(<RecognitionEvidence recognition={run} duration={8} reviews={[{...base,decision:'rejected'},{...base,decision:'uncertain'}]} />);
 expect(screen.queryByText('riser',{selector:'.sound-tag > span:not(.sr-only):not(.sound-tag__mark):not(.sound-tag__note)'})).toBeNull();
 rerender(<RecognitionEvidence recognition={run} duration={8} reviews={[{...base,decision:'rejected'},{...base,decision:'confirmed'}]} />);
 expect(document.querySelector('.sound-tag--confirmed')).toHaveTextContent(/confirmed by you/);
 expect(run.observations[0].status).toBe('possible');
});
