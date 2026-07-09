import { describe, expect, it } from 'vitest';

type VerifyAirgapModule = {
  extractCspFromHtml: (html: string) => string | null;
  getAirgapCspFailure: (csp: string) => string | null;
};

async function loadVerifier(): Promise<VerifyAirgapModule> {
  return import(new URL('../../scripts/verify-airgap.mjs', import.meta.url).href);
}

describe('verify-airgap script', () => {
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
