import { describe, it, expect } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('normal build allows exactly the two opt-in AI connect-src hosts', () => {
    const csp = buildCsp({ airgap: false });
    expect(csp).toContain(
      "connect-src 'self' blob: https://generativelanguage.googleapis.com https://openrouter.ai",
    );
  });

  it('airgap build has no external host anywhere in the policy', () => {
    const csp = buildCsp({ airgap: true });
    expect(csp).toContain("connect-src 'self' blob:");
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toContain('generativelanguage');
    expect(csp).not.toContain('openrouter');
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
