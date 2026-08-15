// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { DEFAULT_FILTER, useUiStore } from '../store/uiStore';
import SceneLegend from './SceneLegend';

describe('SceneLegend', () => {
  afterEach(() => {
    cleanup();
    useGraphStore.getState().reset();
    useUiStore.setState({ filter: { ...DEFAULT_FILTER } });
  });

  it('stays collapsed until the Links button is clicked', () => {
    useGraphStore.setState({
      edges: [
        { id: 'a', source: '1', target: '2', kind: 'semantic', weight: 0.8, evidence: ['alike'] },
      ],
    });

    render(<SceneLegend />);
    expect(screen.getByRole('button', { name: 'Links' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /similar/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Links' }));
    expect(screen.getByRole('button', { name: 'Links' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /similar/i })).toBeInTheDocument();
  });

  it('shows edge-kind counts and toggles visibility', () => {
    useGraphStore.setState({
      edges: [
        { id: 'a', source: '1', target: '2', kind: 'semantic', weight: 0.8, evidence: ['alike'] },
        { id: 'b', source: '1', target: '3', kind: 'reference', weight: 1, evidence: ['links'] },
        { id: 'c', source: '2', target: '3', kind: 'semantic', weight: 0.7, evidence: ['alike'] },
      ],
    });

    render(<SceneLegend />);
    fireEvent.click(screen.getByRole('button', { name: 'Links' }));
    expect(screen.getByRole('button', { name: /similar/i })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /reference/i })).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /similar/i }));
    expect(useUiStore.getState().filter.edgeKinds).toEqual(['reference', 'keyword', 'entity']);
  });
});
