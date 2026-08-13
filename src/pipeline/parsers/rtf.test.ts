import { describe, it, expect } from 'vitest';
import { parseRtf } from './rtf';

function textToArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('parseRtf', () => {
  it('parses basic RTF text extraction', () => {
    const bytes = textToArrayBuffer('{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}}\n{\\*\\generator Riched20 10.0.19041}\\viewkind4\\uc1 \n\\pard\\sa200\\sl276\\slmult1\\f0\\fs22\\lang9 Hello World\\par\nThis is a test.\\par\n}');
    const result = parseRtf(bytes, 'test.rtf');
    
    expect(result.text).toContain('Hello World\nThis is a test.');
    expect(result.status).toBe('ok');
    expect(result.title).toBe('Test');
  });

  it('handles Unicode escapes', () => {
    // \u21328? means character 21328, fallback ?
    const bytes = textToArrayBuffer('{\\rtf1 \\u21328? is a unicode char}');
    const result = parseRtf(bytes, 'test.rtf');
    expect(result.text).toContain(String.fromCharCode(21328) + ' is a unicode char');
  });

  it('handles hex escapes', () => {
    // \'e9 is é in some codepages, we parse it as String.fromCharCode(0xe9)
    const bytes = textToArrayBuffer('{\\rtf1 caf\\\'e9}');
    const result = parseRtf(bytes, 'test.rtf');
    expect(result.text).toContain('caf\xE9');
  });

  it('handles destination group skipping', () => {
    const bytes = textToArrayBuffer('{\\rtf1 {\\fonttbl \\f0 Arial;} Visible {\\colortbl \\red0\\green0\\blue0;} Text {\\stylesheet style1;} Here {\\info metadata;} ! {\\*\\ignored data} }');
    const result = parseRtf(bytes, 'test.rtf');
    expect(result.text).toContain('Visible Text Here !');
    expect(result.text).not.toContain('Arial');
    expect(result.text).not.toContain('red0');
  });

  it('handles paragraph handling', () => {
    const bytes = textToArrayBuffer('{\\rtf1 Line 1\\line Line 2\\par Line 3\\tab Tabbed}');
    const result = parseRtf(bytes, 'test.rtf');
    expect(result.text).toContain('Line 1\nLine 2\nLine 3\tTabbed');
  });
});
