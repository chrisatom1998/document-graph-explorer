import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

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
