import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

type VerifyAirgapModule = {
  extractCspFromHtml: (html: string) => string | null;
  getAirgapCspFailure: (csp: string) => string | null;
};

async function loadVerifier(): Promise<VerifyAirgapModule> {
  return import(new URL('../../scripts/verify-airgap.mjs', import.meta.url).href);
}

describe('verify-airgap script', () => {
  it('accepts the production airgap policy', async () => {
    const { getAirgapCspFailure } = await loadVerifier();
    expect(getAirgapCspFailure(buildCsp({ airgap: true }))).toBeNull();
  });

  it.each([
    'default-src *',
    "default-src 'self'",
    "connect-src 'self'",
    "default-src https:; connect-src 'self'",
    "default-src 'self'; connect-src 'self'; img-src *",
    "default-src 'self'; connect-src 'self'; img-src telemetry.example.com",
    "default-src 'self'; connect-src 'self'; font-src https:",
    "default-src 'self'; connect-src 'self'; frame-src //example.com",
    "default-src 'self'; connect-src 'self'; form-action https://example.com",
    "default-src 'self'; connect-src 'self'; report-uri /csp-reports",
    "default-src 'self'; connect-src 'self'; connect-src *",
    "default-src 'self'; connect-src",
  ])('rejects an unsafe or incomplete policy: %s', async (policy) => {
    const { getAirgapCspFailure } = await loadVerifier();
    expect(getAirgapCspFailure(policy)).not.toBeNull();
  });

  it('recognizes mixed case directives and arbitrary whitespace', async () => {
    const { getAirgapCspFailure } = await loadVerifier();
    expect(getAirgapCspFailure("DEFAULT-SRC\t'self'; CONNECT-SRC\n'self' blob:")).toBeNull();
  });

  it('checks the browser-decoded CSP meta content', async () => {
    const { extractCspFromHtml, getAirgapCspFailure } = await loadVerifier();
    const html =
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; connect-src &#39;self&#39; blob:;">';

    const csp = extractCspFromHtml(html);

    expect(csp).toBe("default-src 'self'; connect-src 'self' blob:;");
    expect(getAirgapCspFailure(csp!)).toBeNull();
  });

  it('still rejects external connect-src hosts after decoding', async () => {
    const { extractCspFromHtml, getAirgapCspFailure } = await loadVerifier();
    const html =
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; connect-src &#39;self&#39; blob: https://example.invalid;">';

    const csp = extractCspFromHtml(html);

    expect(getAirgapCspFailure(csp!)).toContain('https://example.invalid');
  });
});
