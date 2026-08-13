// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, renderHook } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import React, { useRef } from 'react';
import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap custom hook', () => {
  let originalOffsetWidth: PropertyDescriptor | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Store original descriptors if present
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

    // Mock non-zero layout dimensions for jsdom
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return 100;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 100;
      },
    });
  });

  afterEach(() => {
    // Restore original property descriptors
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    }
    document.body.innerHTML = '';
  });

  // Harness Component for rendering tests using React.createElement for pure .ts file compatibility
  function TestDialog({ active = true, showSecondButton = true }: { active?: boolean; showSecondButton?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(ref, active);

    return React.createElement(
      'div',
      null,
      React.createElement('button', { 'data-testid': 'outside-btn' }, 'Outside Button'),
      React.createElement(
        'div',
        { ref, tabIndex: -1, 'data-testid': 'dialog-container' },
        React.createElement('button', { 'data-testid': 'first-btn' }, 'First Button'),
        React.createElement('input', { 'data-testid': 'middle-input' }),
        showSecondButton ? React.createElement('button', { 'data-testid': 'last-btn' }, 'Last Button') : null,
      ),
    );
  }

  it('moves focus to the first focusable element when activated', () => {
    const { getByTestId } = render(React.createElement(TestDialog, { active: true }));
    const firstBtn = getByTestId('first-btn');
    expect(document.activeElement).toBe(firstBtn);
  });

  it('falls back to focusing container if no focusable children exist', () => {
    function EmptyDialog() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, true);
      return React.createElement(
        'div',
        { ref, tabIndex: -1, 'data-testid': 'empty-container' },
        React.createElement('span', null, 'No focusable elements'),
      );
    }

    const { getByTestId } = render(React.createElement(EmptyDialog));
    const container = getByTestId('empty-container');
    expect(document.activeElement).toBe(container);
  });

  it('does not change focus when active is false', () => {
    const outsideBtn = document.createElement('button');
    outsideBtn.id = 'trigger';
    document.body.appendChild(outsideBtn);
    outsideBtn.focus();

    render(React.createElement(TestDialog, { active: false }));
    expect(document.activeElement).toBe(outsideBtn);
  });

  it('traps Tab focus (forward cycle from last element to first element)', () => {
    const { getByTestId } = render(React.createElement(TestDialog, { active: true }));
    const firstBtn = getByTestId('first-btn');
    const lastBtn = getByTestId('last-btn');
    const container = getByTestId('dialog-container');

    // Move focus to last button
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);

    // Fire Tab on last element
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true, cancelable: true });
    const prevented = !container.dispatchEvent(event);

    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(firstBtn);
  });

  it('traps Shift+Tab focus (backward cycle from first element/container to last element)', () => {
    const { getByTestId } = render(React.createElement(TestDialog, { active: true }));
    const firstBtn = getByTestId('first-btn');
    const lastBtn = getByTestId('last-btn');
    const container = getByTestId('dialog-container');

    // Focus is on first button initially
    expect(document.activeElement).toBe(firstBtn);

    // Fire Shift+Tab on first element
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    const prevented = !container.dispatchEvent(event);

    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(lastBtn);
  });

  it('allows natural Tab navigation when focus is in the middle', () => {
    const { getByTestId } = render(React.createElement(TestDialog, { active: true }));
    const middleInput = getByTestId('middle-input');
    const container = getByTestId('dialog-container');

    middleInput.focus();
    expect(document.activeElement).toBe(middleInput);

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false, bubbles: true, cancelable: true });
    const prevented = !container.dispatchEvent(event);

    // Default should NOT be prevented for middle elements
    expect(prevented).toBe(false);
  });

  it('ignores non-Tab keydown events', () => {
    const { getByTestId } = render(React.createElement(TestDialog, { active: true }));
    const firstBtn = getByTestId('first-btn');
    const container = getByTestId('dialog-container');

    firstBtn.focus();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const prevented = !container.dispatchEvent(event);

    expect(prevented).toBe(false);
    expect(document.activeElement).toBe(firstBtn);
  });

  it('restores focus to previously focused element when unmounted', () => {
    const outsideBtn = document.createElement('button');
    document.body.appendChild(outsideBtn);
    outsideBtn.focus();
    expect(document.activeElement).toBe(outsideBtn);

    const { unmount } = render(React.createElement(TestDialog, { active: true }));
    expect(document.activeElement).not.toBe(outsideBtn);

    unmount();
    expect(document.activeElement).toBe(outsideBtn);
  });

  it('safely skips focus restoration if previouslyFocused element is disconnected (.isConnected safety)', () => {
    const outsideBtn = document.createElement('button');
    document.body.appendChild(outsideBtn);
    outsideBtn.focus();
    const focusSpy = vi.spyOn(outsideBtn, 'focus');

    const { unmount } = render(React.createElement(TestDialog, { active: true }));

    // Remove previously focused element from DOM before unmount
    document.body.removeChild(outsideBtn);
    expect(outsideBtn.isConnected).toBe(false);

    unmount();
    // focus() should NOT be called on disconnected element
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('filters out hidden focusable elements (offsetWidth/offsetHeight === 0)', () => {
    const container = document.createElement('div');
    const visibleBtn = document.createElement('button');
    const hiddenBtn = document.createElement('button');

    Object.defineProperty(visibleBtn, 'offsetWidth', { value: 100, configurable: true });
    Object.defineProperty(visibleBtn, 'offsetHeight', { value: 100, configurable: true });
    Object.defineProperty(hiddenBtn, 'offsetWidth', { value: 0, configurable: true });
    Object.defineProperty(hiddenBtn, 'offsetHeight', { value: 0, configurable: true });

    container.appendChild(hiddenBtn);
    container.appendChild(visibleBtn);
    document.body.appendChild(container);

    const ref = { current: container };
    renderHook(() => useFocusTrap(ref, true));

    // Visible button should be focused first, skipping hidden button
    expect(document.activeElement).toBe(visibleBtn);
  });
});
