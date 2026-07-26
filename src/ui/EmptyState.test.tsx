// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  afterEach(cleanup);

  it('renders the welcome actions', () => {
    render(<EmptyState />);

    expect(screen.getByText('Turn scattered files into a living map.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add files' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Load demo corpus' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import a graph' })).toBeVisible();
  });
});
