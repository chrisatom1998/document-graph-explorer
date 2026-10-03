// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SampleAssistantLauncher from './SampleAssistantLauncher';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('innerWidth', 1000); vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId = 1; isPrimary = true;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(parseFloat(this.style.left) || 25, parseFloat(this.style.top) || 725, 250, 50);
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const setup = () => {
  const onOpen = vi.fn(); render(<SampleAssistantLauncher count={16} onOpen={onOpen} />);
  return { button: screen.getByRole('button'), onOpen };
};
describe('movable sample assistant launcher', () => {
  it('drags and remembers its position without opening the panel', () => {
    const { button, onOpen } = setup();
    fireEvent.pointerDown(button, { clientX: 100, clientY: 750, button: 0 });
    fireEvent.pointerMove(button, { clientX: 300, clientY: 450 });
    fireEvent.pointerUp(button); fireEvent.click(button, { detail: 1 });
    expect(button).toHaveStyle({ left: '225px', top: '425px', bottom: 'auto' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('dge:sample-assistant-position')!)).toEqual({ x: 225, y: 425 });
    cleanup(); setup(); expect(screen.getByRole('button')).toHaveStyle({ left: '225px', top: '425px' });
  });
  it('treats a click with small pointer movement as a normal click', () => {
    const { button, onOpen } = setup();
    fireEvent.pointerDown(button, { clientX: 100, clientY: 750, button: 0 });
    fireEvent.pointerMove(button, { clientX: 102, clientY: 751 });
    fireEvent.pointerUp(button); fireEvent.click(button, { detail: 1 });
    expect(onOpen).toHaveBeenCalledOnce(); expect(button.style.top).toBe('');
  });
  it('clamps movement and resize, supports keyboard movement and resets with Home', () => {
    const { button, onOpen } = setup();
    fireEvent.pointerDown(button, { clientX: 100, clientY: 750, button: 0 });
    fireEvent.pointerMove(button, { clientX: 9000, clientY: 9000 });
    fireEvent.pointerUp(button); fireEvent.click(button, { detail: 1 });
    expect(button).toHaveStyle({ left: '750px', top: '750px' });
    vi.stubGlobal('innerWidth', 500); vi.stubGlobal('innerHeight', 400); fireEvent.resize(window);
    expect(button).toHaveStyle({ left: '250px', top: '350px' });
    fireEvent.keyDown(button, { key: 'ArrowLeft' }); expect(button).toHaveStyle({ left: '240px' });
    fireEvent.click(button, { detail: 0 }); expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.keyDown(button, { key: 'Home' });
    expect(button.style.left).toBe(''); expect(button.style.top).toBe('');
    expect(localStorage.getItem('dge:sample-assistant-position')).toBeNull();
  });
  it('ignores malformed saved positions and stops moving after cancellation', () => {
    localStorage.setItem('dge:sample-assistant-position', '{"x":"bad","y":12}');
    const { button } = setup(); expect(button.style.left).toBe('');
    fireEvent.pointerDown(button, { clientX: 100, clientY: 750, button: 0 });
    fireEvent.pointerCancel(button); fireEvent.pointerMove(button, { clientX: 300, clientY: 450 });
    expect(button.style.left).toBe('');
  });
});
