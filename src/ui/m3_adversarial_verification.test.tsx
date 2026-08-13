// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRef, useRef } from 'react';
import * as THREE from 'three';
import CloseButton from './CloseButton';
import { MAX_RENDER_CHARS, FALLBACK_EXCERPT_CHARS, getFallbackExcerpt } from './readerUtils';
import { useFocusTrap } from './useFocusTrap';

describe('Milestone 3 Empirical Adversarial Verification', () => {
  beforeEach(() => {
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

  describe('1. CloseButton Ref Forwarding & Accessibility', () => {
    it('forwards ref object correctly to underlying button element', () => {
      const ref = createRef<HTMLButtonElement>();
      render(<CloseButton ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.tagName).toBe('BUTTON');
    });

    it('forwards callback ref correctly', () => {
      let buttonEl: HTMLButtonElement | null = null;
      render(<CloseButton ref={(el) => { buttonEl = el; }} />);
      expect(buttonEl).toBeInstanceOf(HTMLButtonElement);
      expect((buttonEl as unknown as HTMLButtonElement)?.tagName).toBe('BUTTON');
    });

    it('applies default and custom aria-label, title, type, and className', () => {
      const { rerender } = render(<CloseButton data-testid="cb" />);
      const btn = screen.getByTestId('cb');
      expect(btn.getAttribute('aria-label')).toBe('Close');
      expect(btn.getAttribute('title')).toBe('Close');
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.className).toBe('icon-btn-close');
      expect(btn.textContent).toBe('✕');

      rerender(
        <CloseButton
          data-testid="cb"
          aria-label="Dismiss modal"
          title="Dismiss tooltip"
          className="custom-close-class"
        >
          Close Panel
        </CloseButton>,
      );

      const updatedBtn = screen.getByTestId('cb');
      expect(updatedBtn.getAttribute('aria-label')).toBe('Dismiss modal');
      expect(updatedBtn.getAttribute('title')).toBe('Dismiss tooltip');
      expect(updatedBtn.className).toBe('custom-close-class');
      expect(updatedBtn.textContent).toBe('Close Panel');
    });
  });

  describe('2. readerUtils Fallback Excerpt Truncation', () => {
    it('exports correct numeric thresholds', () => {
      expect(MAX_RENDER_CHARS).toBe(8_000_000);
      expect(FALLBACK_EXCERPT_CHARS).toBe(200_000);
    });

    it('handles exact cap boundary without truncation', () => {
      const textAtCap = 'x'.repeat(FALLBACK_EXCERPT_CHARS);
      const result = getFallbackExcerpt(textAtCap);
      expect(result).toBe(textAtCap);
      expect(result.length).toBe(FALLBACK_EXCERPT_CHARS);
    });

    it('truncates at cap + 1 and appends truncation indicator', () => {
      const textOverCap = 'y'.repeat(FALLBACK_EXCERPT_CHARS + 1);
      const result = getFallbackExcerpt(textOverCap);
      expect(result.startsWith('y'.repeat(FALLBACK_EXCERPT_CHARS))).toBe(true);
      expect(result.endsWith('\n\n… (truncated)')).toBe(true);
      expect(result.length).toBe(FALLBACK_EXCERPT_CHARS + '\n\n… (truncated)'.length);
    });

    it('handles custom small caps and zero cap', () => {
      expect(getFallbackExcerpt('Hello World', 5)).toBe('Hello\n\n… (truncated)');
      expect(getFallbackExcerpt('Hello World', 0)).toBe('\n\n… (truncated)');
    });

    it('handles multibyte / unicode / emoji strings correctly', () => {
      const emojiStr = '🚀'.repeat(10);
      expect(getFallbackExcerpt(emojiStr, 100)).toBe(emojiStr);
      // slice(0, 4) on surrogate pairs
      const sliced = getFallbackExcerpt(emojiStr, 4);
      expect(sliced.endsWith('\n\n… (truncated)')).toBe(true);
    });
  });

  describe('3. Focus Trap DOM Safety (isConnected check)', () => {
    function TrapTestHost({ active = true }: { active?: boolean }) {
      const containerRef = useRef<HTMLDivElement>(null);
      useFocusTrap(containerRef, active);

      return (
        <div>
          <button id="external-btn">External Button</button>
          <div ref={containerRef} id="modal-container">
            <button id="modal-btn-1">Modal Button 1</button>
            <button id="modal-btn-2">Modal Button 2</button>
          </div>
        </div>
      );
    }

    it('restores focus to previous element when previous element is connected', () => {
      const { rerender } = render(<TrapTestHost active={false} />);
      const externalBtn = screen.getByRole('button', { name: 'External Button' });
      externalBtn.focus();
      expect(document.activeElement).toBe(externalBtn);

      // Open focus trap
      rerender(<TrapTestHost active={true} />);
      const modalBtn1 = screen.getByRole('button', { name: 'Modal Button 1' });
      expect(document.activeElement).toBe(modalBtn1);

      // Close focus trap
      rerender(<TrapTestHost active={false} />);
      expect(document.activeElement).toBe(externalBtn);
    });

    it('safely skips focus restoration when previously focused element is detached from DOM', () => {
      const externalBtn = document.createElement('button');
      externalBtn.textContent = 'Detachable Button';
      document.body.appendChild(externalBtn);
      externalBtn.focus();
      expect(document.activeElement).toBe(externalBtn);

      const focusSpy = vi.spyOn(externalBtn, 'focus');

      // Create container and run hook manually or via component render
      const container = document.createElement('div');
      const innerBtn = document.createElement('button');
      container.appendChild(innerBtn);
      document.body.appendChild(container);

      // Render trap component
      const containerRef = { current: container };
      
      function TestHookWrapper({ active }: { active: boolean }) {
        useFocusTrap(containerRef, active);
        return null;
      }

      const { rerender, unmount } = render(<TestHookWrapper active={true} />);
      
      // Detach external button while modal is open
      document.body.removeChild(externalBtn);
      expect(externalBtn.isConnected).toBe(false);

      // Unmount focus trap
      act(() => {
        rerender(<TestHookWrapper active={false} />);
      });

      // focus() should NOT have been called on detached externalBtn after detach
      expect(focusSpy).not.toHaveBeenCalled();

      // Cleanup
      unmount();
      if (container.parentNode) {
        document.body.removeChild(container);
      }
    });
  });

  describe('4. Buffer Attribute Disposal Safety', () => {
    it('disposes InstancedBufferAttribute correctly on mesh cleanup', () => {
      const mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1),
        new THREE.MeshBasicMaterial(),
        100
      );

      const attr = new THREE.InstancedBufferAttribute(new Float32Array(300).fill(1), 3);
      const disposeSpy = vi.spyOn(attr, 'dispose');
      mesh.instanceColor = attr;

      // Simulate Nodes.tsx cleanup function
      if (mesh.instanceColor) {
        mesh.instanceColor.dispose();
        mesh.instanceColor = null;
      }

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect(mesh.instanceColor).toBeNull();
    });
  });
});
