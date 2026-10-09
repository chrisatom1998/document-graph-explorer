// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CopilotProperties from './CopilotProperties';
import { sanitizeMusicAnalysis } from '../audio/musicTypes';

afterEach(cleanup);
it.each([undefined, { startSeconds: 0, durationSeconds: 9999 }])('does not claim listening for missing or invalid excerpt provenance: %j', audioExcerpt => {
  const audio = sanitizeMusicAnalysis({ version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
    copilotProperties: { model: 'gpt-audio-1.5', tags: { source: ['voice'], production: [], character: [] }, audioExcerpt } })!;
  render(<CopilotProperties audio={audio} />);
  expect(screen.getByText(/without validated audio-excerpt provenance/)).toBeInTheDocument();
  expect(screen.queryByText(/from an uploaded audio excerpt/)).not.toBeInTheDocument();
});
it('shows validated excerpt coverage', () => {
  const audio = sanitizeMusicAnalysis({ version: 2, durationSeconds: 8, analyzedSeconds: 8, instruments: [], notes: [],
    copilotProperties: { model: 'gpt-audio-1.5', tags: { source: ['voice'], production: [], character: [] }, audioExcerpt: { startSeconds: 0, durationSeconds: 8 } } })!;
  render(<CopilotProperties audio={audio} />);
  expect(screen.getByText(/from an uploaded audio excerpt \(first 8.0s\)/)).toBeInTheDocument();
});
