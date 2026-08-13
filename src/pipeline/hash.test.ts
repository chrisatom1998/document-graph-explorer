import { describe, expect, it } from 'vitest';
import { fnv1a32, fnv1a32Hex, sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('hashes string inputs to deterministic 64-character hex digests', async () => {
    const hashEmpty = await sha256Hex('');
    expect(hashEmpty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    const hashHello = await sha256Hex('hello');
    expect(hashHello).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');

    const hashHelloWorld = await sha256Hex('hello world');
    expect(hashHelloWorld).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('produces identical hex output for ArrayBuffer and string with identical byte content', async () => {
    const str = 'document-graph-explorer';
    const encoder = new TextEncoder();
    const buffer = encoder.encode(str).buffer;

    const hashFromStr = await sha256Hex(str);
    const hashFromBuf = await sha256Hex(buffer);

    expect(hashFromBuf).toBe(hashFromStr);
  });

  it('produces valid 64-character lowercase hexadecimal strings', async () => {
    const hash = await sha256Hex('test data 123');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes significantly with a single character difference (avalanche effect)', async () => {
    const hash1 = await sha256Hex('test1');
    const hash2 = await sha256Hex('test2');
    expect(hash1).not.toBe(hash2);
  });
});

describe('fnv1a32 & fnv1a32Hex', () => {
  it('computes standard FNV-1a 32-bit integer hashes deterministically', () => {
    // Empty string: FNV offset basis = 0x811c9dc5 = 2166136261
    expect(fnv1a32('')).toBe(2166136261);

    // Standard FNV-1a 32 test vector for "a" = 0xe40d652c = 3826002220
    expect(fnv1a32('a')).toBe(3826002220);

    // Standard FNV-1a 32 test vector for "foobar" = 0xbf9cf968 = 3214735720
    expect(fnv1a32('foobar')).toBe(3214735720);
  });

  it('formats FNV-1a hash as 8-character zero-padded hex string', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
    expect(fnv1a32Hex('a')).toBe('e40c292c');
    expect(fnv1a32Hex('foobar')).toBe('bf9cf968');
  });

  it('handles Uint8Array input identically to corresponding string input', () => {
    const text = 'pipeline-hash-test';
    const bytes = new TextEncoder().encode(text);

    expect(fnv1a32(bytes)).toBe(fnv1a32(text));
    expect(fnv1a32Hex(bytes)).toBe(fnv1a32Hex(text));
  });

  it('always produces an unsigned 32-bit integer in range [0, 2^32 - 1]', () => {
    const samples = ['alpha', 'beta', 'gamma', 'delta', '1234567890'];
    for (const sample of samples) {
      const h = fnv1a32(sample);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(h)).toBe(true);
    }
  });
});
