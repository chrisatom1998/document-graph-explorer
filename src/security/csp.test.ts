import { describe, it, expect } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('normal build allows exactly the opt-in AI connect-src hosts', () => {
    const csp = buildCsp({ airgap: false });
    expect(csp).toContain(
      "connect-src 'self' blob: https://openrouter.ai http://127.0.0.1:11434 http://localhost:11434",
    );
    // Gemini was removed as a provider — its host must stay gone.
    expect(csp).not.toContain('generativelanguage');
  });

  it('only loopback hosts are allowed over plain http', () => {
    const csp = buildCsp({ airgap: false });
    const plainHttpHosts = csp.match(/http:\/\/[^\s;]+/g) ?? [];
    for (const host of plainHttpHosts) {
      expect(host).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):11434$/);
    }
  });

  it('airgap build has no external host anywhere in the policy', () => {
    const csp = buildCsp({ airgap: true });
    expect(csp).toContain("connect-src 'self' blob:");
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toContain('generativelanguage');
    expect(csp).not.toContain('openrouter');
    expect(csp).not.toContain('11434');
  });

  it('both modes keep the non-connect directives identical', () => {
    const normal = buildCsp({ airgap: false });
    const air = buildCsp({ airgap: true });
    for (const d of ["script-src 'self' 'wasm-unsafe-eval' blob:", "worker-src 'self' blob:", "object-src 'none'"]) {
      expect(normal).toContain(d);
      expect(air).toContain(d);
    }
  });
});
