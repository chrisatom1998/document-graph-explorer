// @vitest-environment jsdom
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useDialogDrag } from './useDialogDrag';

function Harness() {
  const ref = useRef<HTMLDialogElement>(null);
  const { headerProps, reset } = useDialogDrag(ref, true);
  return <dialog open ref={ref}><header data-testid="header" {...headerProps}>
    <span>Title</span><button data-drag-handle>Move</button><button>Close</button>
  </header><input aria-label="Search" /><button onClick={reset}>Reset</button></dialog>;
}
beforeEach(() => {
  vi.stubGlobal('innerWidth', 1200); vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number; isPrimary: boolean;
    constructor(type: string, options: PointerEventInit = {}) {
      super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true;
    }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(this.style.left ? parseFloat(this.style.left) : 200, this.style.top ? parseFloat(this.style.top) : 200, 800, 500);
  });
  // jsdom does not implement pointer capture; real-browser coverage exercises it.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const start = (target = screen.getByTestId('header')) => fireEvent.pointerDown(target, { pointerId: 1, clientX: 250, clientY: 220, button: 0, isPrimary: true });
const move = (x: number, y: number, pointerId = 1) => fireEvent.pointerMove(screen.getByTestId('header'), { pointerId, clientX: x, clientY: y });

describe('draggable sample dialog', () => {
  it('drags from the header, clamps to the viewport and stops on pointer release', () => {
    render(<Harness />); start(); move(350, 260);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ left: '300px', top: '240px' });
    move(9999, 9999); expect(dialog).toHaveStyle({ left: '400px', top: '400px' });
    move(-999, -999); expect(dialog).toHaveStyle({ left: '0px', top: '0px' });
    fireEvent.pointerUp(screen.getByTestId('header'), { pointerId: 1 }); move(350, 260);
    expect(dialog).toHaveStyle({ left: '0px', top: '0px' });
    expect(dialog).not.toHaveAttribute('data-dragging');
  });
  it('ignores controls, secondary buttons and other pointers', () => {
    render(<Harness />); start(screen.getByRole('button', { name: 'Close' })); move(350, 260);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-positioned');
    fireEvent.pointerDown(screen.getByTestId('header'), { button: 2 }); move(350, 260);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-positioned');
    start(); move(350, 260, 2);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-positioned');
    fireEvent.pointerCancel(screen.getByTestId('header')); move(350, 260);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-positioned');
  });
  it('supports the move handle, arrow keys and Home to center without changing input text', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Move' });
    start(button); move(350, 260);
    fireEvent.lostPointerCapture(screen.getByTestId('header')); move(500, 500);
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '300px', top: '240px' });
    fireEvent.keyDown(button, { key: 'ArrowLeft', shiftKey: true });
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '260px' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '260px' });
    fireEvent.keyDown(button, { key: 'Home' });
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-positioned');
    expect(screen.getByRole('dialog').style.left).toBe('');
  });
  it('keeps the panel visible after resizing and can reset on reopening', () => {
    render(<Harness />); start(); move(450, 420);
    vi.stubGlobal('innerWidth', 850); vi.stubGlobal('innerHeight', 600);
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '50px', top: '100px' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-positioned');
  });
});
