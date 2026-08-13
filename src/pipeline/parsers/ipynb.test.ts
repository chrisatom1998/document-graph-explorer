import { describe, it, expect } from 'vitest';
import { parseIpynb } from './ipynb';

function textToArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('parseIpynb', () => {
  it('parses basic notebook with markdown and code cells', () => {
    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          source: ['# My Notebook Title\n', 'Some text here.']
        },
        {
          cell_type: 'code',
          execution_count: 1,
          source: ['print("Hello")'],
          outputs: []
        }
      ]
    };
    const bytes = textToArrayBuffer(JSON.stringify(notebook));
    const result = parseIpynb(bytes, 'test.ipynb');
    
    expect(result.title).toBe('My Notebook Title');
    expect(result.headings).toContain('My Notebook Title');
    expect(result.text).toContain('Some text here.');
    expect(result.text).toContain('[In 1]:\nprint("Hello")');
  });

  it('extracts imports as headings', () => {
    const notebook = {
      cells: [
        {
          cell_type: 'code',
          execution_count: 2,
          source: ['import os\n', 'from math import pi\n', 'def my_func():\n', '  pass\n', 'class MyClass:\n', '  pass'],
          outputs: []
        }
      ]
    };
    const bytes = textToArrayBuffer(JSON.stringify(notebook));
    const result = parseIpynb(bytes, 'test.ipynb');
    
    expect(result.headings).toContain('import os');
    expect(result.headings).toContain('from math import pi');
    expect(result.headings).toContain('my_func');
    expect(result.headings).toContain('MyClass');
  });

  it('extracts outputs', () => {
    const notebook = {
      cells: [
        {
          cell_type: 'code',
          execution_count: 3,
          source: ['print(1+1)'],
          outputs: [
            { text: ['2\n'] },
            { data: { 'text/plain': ['3\n'], 'image/png': 'iVBORw0KGgo=' } }
          ]
        }
      ]
    };
    const bytes = textToArrayBuffer(JSON.stringify(notebook));
    const result = parseIpynb(bytes, 'test.ipynb');
    
    expect(result.text).toContain('2');
    expect(result.text).toContain('3');
    expect(result.text).not.toContain('iVBORw0KGgo=');
  });

  it('handles empty or malformed notebooks gracefully', () => {
    const bytes = textToArrayBuffer('invalid json');
    const result = parseIpynb(bytes, 'test.ipynb');
    
    expect(result.status).toBe('unreadable');
    expect(result.text).toBe('');
    
    const emptyBytes = textToArrayBuffer(JSON.stringify({}));
    const emptyResult = parseIpynb(emptyBytes, 'empty.ipynb');
    expect(emptyResult.status).toBe('ok');
    expect(emptyResult.text).toBe('');
    expect(emptyResult.title).toBe('Empty');
  });
});
