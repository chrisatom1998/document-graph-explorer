// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findPassageRange, PASSAGE_MARK_CLASS, unwrapPassageMarks, wrapPassageInElement } from './passageHighlight';

describe('findPassageRange', () => {
  it('finds an exact substring', () => {
    expect(findPassageRange('alpha beta gamma', 'beta')).toEqual({ start: 6, end: 10 });
  });

  it('matches chunk text that collapsed newlines into spaces', () => {
    const haystack = 'Disaster recovery\n\nprocedure is tested quarterly.';
    const needle = 'Disaster recovery procedure is tested quarterly.';
    const range = findPassageRange(haystack, needle);
    expect(range).not.toBeNull();
    expect(haystack.slice(range!.start, range!.end).replace(/\s+/g, ' ').trim()).toMatch(/Disaster recovery/i);
  });

  it('falls back to the leading probe of a long truncated snippet', () => {
    const haystack = 'The recovery point objective (RPO) is fifteen minutes for tier-1 systems.';
    const needle = 'The recovery point objective (RPO) is fifteen minutes for tier-1 systems and a much longer tail that was truncated in the snippet.';
    const range = findPassageRange(haystack, needle);
    expect(range).not.toBeNull();
    expect(haystack.slice(range!.start, range!.end)).toContain('recovery point objective');
  });

  it('returns null when nothing matches', () => {
    expect(findPassageRange('hello world', 'quantum entanglement')).toBeNull();
  });

  it('matches chunk text when the haystack omitted inter-block spaces', () => {
    const haystack = 'Disaster recoveryprocedure is tested quarterly.';
    const needle = 'Disaster recovery procedure is tested quarterly.';
    const range = findPassageRange(haystack, needle);
    expect(range).not.toBeNull();
    expect(haystack.slice(range!.start, range!.end)).toContain('Disaster recovery');
  });

  it('matches compact JSON inside pretty-printed text', () => {
    const haystack = '{\n  "foo": 1\n}';
    const range = findPassageRange(haystack, '{"foo":1}');
    expect(range).not.toBeNull();
    expect(haystack.slice(range!.start, range!.end)).toContain('foo');
  });
});

describe('wrapPassageInElement', () => {
  it('wraps the matching text in a passage mark', () => {
    const root = document.createElement('div');
    root.append('Hello ', document.createTextNode('disaster recovery plan'), document.createTextNode('.'));
    const mark = wrapPassageInElement(root, 'disaster recovery');
    expect(mark).toBeInstanceOf(HTMLElement);
    expect(mark?.className).toBe(PASSAGE_MARK_CLASS);
    expect(root.querySelector('mark')?.textContent).toBe('disaster recovery');
    unwrapPassageMarks(root);
    expect(root.querySelector('mark')).toBeNull();
    expect(root.textContent).toBe('Hello disaster recovery plan.');
  });

  it('wraps a passage split across block elements without interstitial spaces', () => {
    const root = document.createElement('div');
    const p1 = document.createElement('p');
    p1.textContent = 'Disaster recovery';
    const p2 = document.createElement('p');
    p2.textContent = 'procedure is tested quarterly.';
    root.append(p1, p2);
    expect(root.textContent).toBe('Disaster recoveryprocedure is tested quarterly.');
    const mark = wrapPassageInElement(root, 'Disaster recovery procedure is tested quarterly.');
    expect(mark).toBeInstanceOf(HTMLElement);
    expect([...root.querySelectorAll(`mark.${PASSAGE_MARK_CLASS}`)].map((el) => el.textContent).join(''))
      .toMatch(/Disaster recovery/i);
  });

  it('wraps compact JSON that gained spaces in pretty-printed DOM text', () => {
    const root = document.createElement('pre');
    root.textContent = '{\n  "foo": 1\n}';
    const mark = wrapPassageInElement(root, '{"foo":1}');
    expect(mark).toBeInstanceOf(HTMLElement);
    expect(root.querySelector(`mark.${PASSAGE_MARK_CLASS}`)?.textContent).toContain('foo');
  });

  it('wraps CSV cell text whose commas are absent from the table DOM', () => {
    const root = document.createElement('table');
    root.innerHTML = '<tr><td>name</td><td>age</td></tr><tr><td>alice</td><td>30</td></tr>';
    const mark = wrapPassageInElement(root, 'name,age alice,30');
    expect(mark).toBeInstanceOf(HTMLElement);
    expect(root.querySelector(`mark.${PASSAGE_MARK_CLASS}`)?.textContent).toMatch(/name/i);
  });
});
