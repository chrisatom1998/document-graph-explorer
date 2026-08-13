import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMBED_MODEL_ID } from '../config';

const modelsRoot = join(__dirname, '../../public/models');

describe('bundled embedding model', () => {
  it('ships only bge-small-en-v1.5 (MiniLM leftovers must not return)', () => {
    expect(EMBED_MODEL_ID).toBe('Xenova/bge-small-en-v1.5');
    expect(existsSync(join(modelsRoot, 'Xenova', 'bge-small-en-v1.5', 'config.json'))).toBe(true);
    expect(existsSync(join(modelsRoot, 'Xenova', 'all-MiniLM-L6-v2'))).toBe(false);
  });
});
