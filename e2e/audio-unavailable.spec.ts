import { test, expect } from '@playwright/test';
import { correctDjTags } from './sampleAssistant';

test('unavailable models stay explicit through correction, cancellation and restart', async ({ page }) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) remote.push(request.url());
  });
  const workerResponse = page.waitForResponse(response => /\/assets\/musicAnalysis\.worker-[^/]+\.js$/.test(response.url()));
  await page.addInitScript(() => localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'fast' })));
  await page.route(/\/(music-model|sound-model|jamendo-model)\/.*\.onnx/, route => route.abort('failed'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  // Generate our own 3-second 440 Hz PCM WAV: no private or licensed samples.
  await page.locator('input[type="file"]').first().evaluate(element => {
    const count = 16000 * 3;
    const buffer = new ArrayBuffer(44 + count * 2);
    const view = new DataView(buffer);
    const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 8000), true);
    const transfer = new DataTransfer();
    transfer.items.add(new File([buffer], 'Synthetic tone.wav', { type: 'audio/wav' }));
    Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeVisible({ timeout: 240_000 });
  const openTrack = async () => {
    await page.getByRole('button', { name: 'Search documents' }).click();
    await page.getByRole('option', { name: /Synthetic tone/i }).click();
    await expect(page.locator('.audio-preview')).toBeVisible();
  };
  await openTrack();
  await expect(page.getByRole('region', { name: 'Musical features' })).toContainText('Analysis: partial');
  const details = page.getByText('Technical details', { exact: true });
  if (await details.locator('..').getAttribute('open') === null) await details.click();
  await expect(page.getByRole('region', { name: 'Musical features' })).toContainText('AST: failed');
  await expect(page.getByRole('region', { name: 'Musical features' })).toContainText('Jamendo: failed');
  await expect(page.getByRole('region', { name: 'Musical features' })).toContainText('CLAP: failed');
  // A meta CSP does not cover the worker. Require the production header so
  // runtime code generation in audio dependencies cannot pass locally.
  const workerCsp = (await workerResponse).headers()['content-security-policy'];
  expect(workerCsp).toContain("'wasm-unsafe-eval'");
  expect(workerCsp).not.toContain("'unsafe-eval'");
  await expect(page.getByRole('region', { name: 'Musical features' })).toBeVisible();
  await page.getByText('Track actions', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reanalyze musical features' })).toBeEnabled();
  await expect(page.locator('.side-panel audio')).toHaveAttribute('src', /^blob:/);
  await correctDjTags(page, /Synthetic tone/i, card => card.getByRole('checkbox', { name: 'synthesizer', exact: true }).check(), 'Your DJ tags are saved.');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeVisible();
  await openTrack();
  await expect(page.locator('.music-features')).toContainText('synthesizer');
  await page.getByText('Track actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Reanalyze musical features' }).click();
  await page.getByRole('button', { name: 'Cancel analysis' }).click();
  await expect(page.getByRole('button', { name: 'Reanalyze musical features' })).toBeEnabled();
  await expect(page.locator('.music-features')).toContainText('synthesizer');
  await page.getByRole('button', { name: 'Reanalyze musical features' }).click();
  await expect(page.getByRole('button', { name: 'Reanalyze musical features' })).toBeEnabled({ timeout: 120_000 });
  await page.getByText('Technical details', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Musical features' })).toContainText('AST: failed');
  await expect(page.locator('.music-features')).toContainText('synthesizer');
  await page.screenshot({ path: '/tmp/dge-models-unavailable.png', fullPage: true });
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
