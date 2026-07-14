import { describe, expect, it } from 'vitest';
import { documentContentId } from './documentId';

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer;
}

describe('documentContentId', () => {
  it('is stable for the same path and bytes but changes with either input', async () => {
    const id = await documentContentId('vault/notes.md', bytes(0, 1, 2, 255));

    expect(id).toMatch(/^[a-f0-9]{64}$/);
    await expect(documentContentId('vault/notes.md', bytes(0, 1, 2, 255))).resolves.toBe(id);
    await expect(documentContentId('vault/renamed.md', bytes(0, 1, 2, 255))).resolves.not.toBe(
      id,
    );
    await expect(documentContentId('vault/notes.md', bytes(0, 1, 3, 255))).resolves.not.toBe(id);
  });

  it('delimits the UTF-8 path from file bytes', async () => {
    const encoder = new TextEncoder();
    const first = await documentContentId('a', encoder.encode('bc').buffer);
    const second = await documentContentId('ab', encoder.encode('c').buffer);

    expect(first).not.toBe(second);
  });
});
