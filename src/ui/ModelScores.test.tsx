// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModelScores } from './ConfidentSoundSummary';
afterEach(cleanup);
it('shows trained sound scores even when every other model list is empty', () => {
  render(<ModelScores profile={{ version: 1, character: [], roles: [], disagreement: false,
    models: [{ model: 'AudioSet AST', complete: true, candidates: [] }],
    djTags: [{ group: 'production', label: 'percussion hit', score: .76, model: 'Trained head' },
      { group: 'source', label: 'drums', score: .76, model: 'Trained head' },
      { group: 'production', label: 'impact', score: .38, model: 'Music CLAP' }] }} />);
  expect(screen.getByText('Trained sounds')).toBeInTheDocument();
  expect(screen.getByText('0.76')).toBeInTheDocument();
  expect(screen.queryByText('AudioSet AST')).toBeNull();
  expect(screen.queryByText('Impact')).toBeNull();
});
it('stays hidden when no model has scores', () => {
  const { container } = render(<ModelScores profile={{ version: 1, character: [], roles: [], disagreement: false, models: [] }} />);
  expect(container).toBeEmptyDOMElement();
});
