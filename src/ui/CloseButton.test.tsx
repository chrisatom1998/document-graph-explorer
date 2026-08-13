// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CloseButton from './CloseButton';

describe('CloseButton component', () => {
  it('renders with default aria-label and title "Close"', () => {
    render(<CloseButton />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('title', 'Close');
    expect(btn).toHaveClass('icon-btn-close');
    expect(btn).toHaveTextContent('✕');
  });

  it('renders with custom aria-label and title', () => {
    render(<CloseButton aria-label="Close custom modal" title="Close modal" />);
    const btn = screen.getByRole('button', { name: 'Close custom modal' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('title', 'Close modal');
  });

  it('handles onClick callback', () => {
    const handleClick = vi.fn();
    render(<CloseButton aria-label="Dismiss panel" onClick={handleClick} />);
    const btn = screen.getByRole('button', { name: 'Dismiss panel' });
    btn.click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
