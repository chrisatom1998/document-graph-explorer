import { describe, it, expect } from 'vitest';
import { looksLikeText } from './textSniffer';

function encodeHex(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}

function encodeText(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('textSniffer', () => {
  it('identifies plain ASCII text as text', () => {
    expect(looksLikeText(encodeText('Hello, world!'))).toBe(true);
    expect(looksLikeText(encodeText('A\nB\tC\r\n'))).toBe(true);
  });

  it('identifies UTF-8 text with BOM as text', () => {
    const text = encodeText('Hello with BOM');
    const bytes = new Uint8Array(3 + text.byteLength);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(new Uint8Array(text), 3);
    expect(looksLikeText(bytes.buffer)).toBe(true);
  });

  it('rejects ELF binary', () => {
    expect(looksLikeText(encodeHex('7f454c4602010100'))).toBe(false);
  });

  it('rejects PNG image', () => {
    expect(looksLikeText(encodeHex('89504e470d0a1a0a'))).toBe(false);
  });

  it('rejects ZIP archive', () => {
    expect(looksLikeText(encodeHex('504b030414000000'))).toBe(false);
  });

  it('rejects PE executable', () => {
    expect(looksLikeText(encodeHex('4d5a900003000000'))).toBe(false);
  });

  it('rejects null-heavy content', () => {
    const bytes = new Uint8Array(100);
    bytes.fill(0x20); // space
    bytes[10] = 0; // null
    bytes[20] = 0; // null
    expect(looksLikeText(bytes.buffer)).toBe(false); // 2% nulls
  });

  it('rejects empty buffer', () => {
    expect(looksLikeText(new ArrayBuffer(0))).toBe(false);
  });

  it('rejects UTF-16 BOM', () => {
    expect(looksLikeText(encodeHex('feff00480065'))).toBe(false); // BE
    expect(looksLikeText(encodeHex('fffe48006500'))).toBe(false); // LE
  });
});
