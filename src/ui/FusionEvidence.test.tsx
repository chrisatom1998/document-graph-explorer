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
it('keeps qualified suggestions and review controls visible but technical support collapsed',()=>{
  vi.mocked(installedFusionIdentity).mockReturnValue(release); const review=vi.fn(); const seek=vi.fn();
  render(<FusionEvidence fusion={fixture()} duration={10} mode="full" onReview={review} onSeek={seek}/>);
  expect(screen.getByRole('list',{name:'Trained source suggestions'})).toBeVisible();
  expect(screen.getByText(/This policy was evaluated/)).not.toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Confirm'})); expect(review).toHaveBeenCalledWith('accordion','source','confirmed');
  fireEvent.click(screen.getByText('Details')); fireEvent.click(screen.getByText('All 20 classifier states and support'));
  expect(screen.getByText('Head score')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Listen to classifier window 0.00–10.00 s'})); expect(seek).toHaveBeenCalledWith(0);
});
it.each(['imported','unvalidated'] as const)('never promotes %s diagnostics into source suggestions',kind=>{
  vi.mocked(installedFusionIdentity).mockReturnValue(release);
  const fusion=fixture(); if(kind==='imported')fusion.imported=true;else fusion.validation='unvalidated';
  render(<FusionEvidence fusion={fusion} duration={10} mode="full"/>);
  expect(screen.queryByRole('list',{name:'Trained source suggestions'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Confirm'})).toBeNull();
  const explanation=screen.getByText(kind==='imported'?/Imported source classifier diagnostics/:/Experimental source classifier diagnostics/);
  expect(explanation).not.toBeVisible(); fireEvent.click(screen.getByText('Details')); expect(explanation).toBeVisible();
});
