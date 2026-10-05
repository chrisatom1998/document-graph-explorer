// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModelScores } from './ConfidentSoundSummary';
import type { MusicAnalysis } from '../audio/musicTypes';
const head = (label: string, headProbability: number, eligible: boolean) => ({ label, state: 'negative', headProbability, decisionProbability: eligible ? headProbability : null,
  source: eligible ? 'learned-head' : 'guarded-binary-baseline', eligible, positiveGroups: 3, negativeGroups: 4 });
vi.mock('../audio/fusionPresentation', async real => ({ ...await real<object>(), fusionPresentation: () => ({ qualified: true,
  windows: [{ status: 'complete', decisions: [head('guitar', .93, false), head('ukulele', .87, true)] }] }) }));
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
it('marks trained detector scores from heads that failed testing as untested', () => {
  render(<ModelScores audio={{ durationSeconds: 40, fusion: {} } as unknown as MusicAnalysis} />);
  const guitar = screen.getByText('untested').closest('li');
  expect(guitar).toHaveTextContent(/guitar/i);
  expect(guitar).toHaveClass('model-scores__item--untested');
  expect(screen.getByText(/ukulele/i).closest('li')).not.toHaveClass('model-scores__item--untested');
});
