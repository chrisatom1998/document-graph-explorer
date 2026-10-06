// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FusionEvidence from './FusionEvidence';
import { FUSION_LABELS, type FusionAnalysis } from '../audio/fusion';
import { installedFusionIdentity } from '../audio/fusionRelease';
const release={modelSha256:'a'.repeat(64),policySha256:'b'.repeat(64),scorerSha256:'c'.repeat(64),modelFileSha256:'d'.repeat(64),receiptSha256:'e'.repeat(64),runtimeSha256:'f'.repeat(64),inputTier:'ogg-full-ten-second-window-v1' as const};
vi.mock('../audio/fusionRelease',async importOriginal=>({ ...await importOriginal<typeof import('../audio/fusionRelease')>(), installedFusionIdentity:vi.fn() }));
const fixture=():FusionAnalysis=>({version:1,scope:'window',validation:'policy-qualified',identity:release,release,planned:1,counts:{complete:1,failed:0,unsupported:0,empty:0},omittedWindows:0,windows:[{start:0,end:10,status:'complete',decisions:FUSION_LABELS.map((label,i)=>({label,state:i===0?'positive':'uncertain',source:'learned-head',headProbability:.8,decisionProbability:.8,eligible:true,positiveGroups:3,negativeGroups:1}))}]});
afterEach(()=>{cleanup();vi.mocked(installedFusionIdentity).mockReset();});
it('keeps qualified score estimates visible without review controls and support collapsed',()=>{
  vi.mocked(installedFusionIdentity).mockReturnValue(release); const review=vi.fn(); const seek=vi.fn();
  render(<FusionEvidence fusion={fixture()} duration={10} mode="full" onReview={review} onSeek={seek}/>);
  expect(screen.getByRole('region',{name:'Sound identification'})).toBeVisible();
  expect(screen.getByText(/Evaluated on public OpenMIC clips/)).not.toBeVisible();
  expect(screen.queryByRole('button',{name:/^(Confirm|Reject|Unsure)$/})).toBeNull();expect(review).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Details')); fireEvent.click(screen.getByText('All 20 classifier states and support'));
  expect(screen.getByText('Head score')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Listen to classifier window 0.00–10.00 s'})); expect(seek).toHaveBeenCalledWith(0);
});
it.each(['imported','unvalidated'] as const)('never promotes %s diagnostics into source suggestions',kind=>{
  vi.mocked(installedFusionIdentity).mockReturnValue(release);
  const fusion=fixture(); if(kind==='imported')fusion.imported=true;else fusion.validation='unvalidated';
  render(<FusionEvidence fusion={fusion} duration={10} mode="full"/>);
  expect(screen.queryByRole('region',{name:'Sound identification'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Confirm'})).toBeNull();
  const explanation=screen.getByText(kind==='imported'?/Imported source classifier diagnostics/:/Experimental source classifier diagnostics/);
  expect(explanation).not.toBeVisible(); fireEvent.click(screen.getByText('Details')); expect(explanation).toBeVisible();
});
it.each(['rejected','uncertain'] as const)('does not revive a %s trained label through the score display',decision=>{
 vi.mocked(installedFusionIdentity).mockReturnValue(release);render(<FusionEvidence fusion={fixture()} duration={10} mode="full" reviews={[{dimension:'source',labelId:'accordion',decision,scope:'track',at:'now',evidenceRunId:'old'}]}/>);expect(screen.queryByText('accordion',{selector:'.sound-tag span'})).toBeNull();
});
it.each([.399999,.4])('uses valid qualified decision scores at the inclusive track floor %s',score=>{
 vi.mocked(installedFusionIdentity).mockReturnValue(release);const fusion=fixture();fusion.windows[0].decisions[0].decisionProbability=score;fusion.windows[0].decisions[0].headProbability=score;render(<FusionEvidence fusion={fusion} duration={10} mode="full"/>);expect(screen.queryByText('accordion',{selector:'.sound-tag span'})!==null).toBe(score>=.4);
});

it('shows a binary fallback positive as a possible yes/no decision, never with the inapplicable head score',()=>{
 vi.mocked(installedFusionIdentity).mockReturnValue(release);const fusion=fixture();Object.assign(fusion.windows[0].decisions[0],{source:'guarded-binary-baseline',headProbability:.99,decisionProbability:null,state:'positive'});render(<FusionEvidence fusion={fusion} duration={10} mode="full"/>);
 const tag=screen.getByText('accordion',{selector:'.sound-tag span'}).closest('li')!;
 expect(tag.getAttribute('data-tier')).toBe('possible');expect(tag.getAttribute('title')).toContain('Baseline fallback score: yes');expect(tag.getAttribute('title')).not.toContain('0.99');
});
