import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(flag: string | undefined) {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (flag !== undefined) vi.stubEnv('VITE_E2E_NO_INFERENCE', flag);
  delete (globalThis as { __DGE_E2E__?: unknown }).__DGE_E2E__;
  return import('./noInference');
}

afterEach(() => { vi.unstubAllEnvs(); delete (globalThis as { __DGE_E2E__?: unknown }).__DGE_E2E__; });

describe('no-inference test boundary', () => {
  it('is off by default and for any value other than 1, so normal builds are unaffected', async () => {
    for (const value of [undefined, '', '0', 'true']) {
      const m = await load(value);
      expect(m.E2E_NO_INFERENCE).toBe(false);
      expect(() => m.assertNoInference('analyzeMusic')).not.toThrow();
      expect(m.e2eCounters().violations).toEqual([]);
    }
  });

  it('refuses and records any inference entry point when on', async () => {
    const m = await load('1');
    expect(m.E2E_NO_INFERENCE).toBe(true);
    expect(() => m.assertNoInference('analyzeMusic')).toThrow(/must not run/);
    expect(m.e2eCounters().violations).toEqual(['analyzeMusic']);
  });

  it('stub embeddings are deterministic, unit length and need no model', async () => {
    const m = await load('1');
    const a = m.e2eStubEmbed(['kick drum loop', 'kick drum loop', 'pad'], 16);
    expect(a.slice(0, 16)).toEqual(a.slice(16, 32));
    expect(a.slice(0, 16)).not.toEqual(a.slice(32, 48));
    for (let row = 0; row < 3; row++) expect(Math.hypot(...a.slice(row * 16, row * 16 + 16))).toBeCloseTo(1, 5);
  });

  it('the production flag cannot be switched on from the repository defaults', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['package.json', 'vercel.json', 'vite.config.ts', '.env', '.env.production']) {
      let text = '';
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      expect(text, file).not.toMatch(/VITE_E2E_NO_INFERENCE/);
    }
  });
});
