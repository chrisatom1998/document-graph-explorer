// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const nightCss = readFileSync(join(process.cwd(), 'src/design/night/night.css'), 'utf8');

function paint(markup: string): void {
  document.head.innerHTML = '';
  document.body.innerHTML = markup;
  const style = document.createElement('style');
  // The shared rules that hide the navigator and drop the export menu, then Night Session's overrides.
  style.textContent = `
    .graph-navigator {
      position: fixed;
      z-index: 40;
      opacity: 0;
      pointer-events: none;
      transform: translateY(calc(-100% - 24px));
      backdrop-filter: blur(16px);
    }
    .graph-navigator.is-expanded { z-index: 30; }
    .graph-navigator.is-expanded #graph-navigator-content { position: absolute; top: 20px; width: calc(100vw - 20px); }
    .toolbar__menu { position: absolute; top: calc(100% + 8px); }
    ${nightCss}
  `;
  document.head.appendChild(style);
}

describe('Night Session embedded panels', () => {
  it('keeps the library list visible and in the sidebar', () => {
    paint(`
      <aside class="ns-library">
        <div class="graph-navigator graph-navigator--embedded is-expanded">
          <div id="graph-navigator-content"></div>
        </div>
      </aside>
    `);
    const navigator = document.querySelector('.graph-navigator') as HTMLElement;
    const content = document.getElementById('graph-navigator-content') as HTMLElement;
    const shown = getComputedStyle(navigator);
    expect(shown.opacity).toBe('1');
    expect(shown.pointerEvents).toBe('auto');
    expect(shown.position).toBe('static');
    expect(shown.transform).toBe('none');
    expect(shown.zIndex).toBe('auto');
    expect(shown.backdropFilter).toBe('none');
    expect(getComputedStyle(content).position).toBe('static');
    expect(getComputedStyle(content).width).not.toBe('calc(100vw - 20px)');
  });

  it('keeps export actions inside the export panel', () => {
    paint(`
      <div class="ns-export"><div class="toolbar__menu"></div></div>
    `);
    expect(getComputedStyle(document.querySelector('.toolbar__menu') as HTMLElement).position).toBe('static');
  });
});
