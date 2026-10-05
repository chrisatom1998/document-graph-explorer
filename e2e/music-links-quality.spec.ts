import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const fixturePath = ENV?.MUSIC_LINKS_FIXTURE;

// This is an opt-in integration check for the licensed cached-feature fixture
// emitted by scripts/evaluate-music-links.mjs, never the user's saved graph.
test('licensed audio fixture keeps its derived edges and honest reasons through filters and reload', async ({ page }, testInfo) => {
  test.skip(!fixturePath, 'Set MUSIC_LINKS_FIXTURE to the evaluator browser fixture.');
  page.setDefaultTimeout(60_000);
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8'));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('knowledge-nebula-theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const importGraph = async (contents: string) => {
    await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
    await page.locator('input[type="file"][accept*=".json"]').evaluate((element, contents) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([contents], 'licensed-audio-fixture.json', { type: 'application/json' }));
      Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, contents);
    await expect(page.getByRole('button', { name: 'Search documents', exact: true })).toBeEnabled();
    const guide = page.getByRole('button', { name: 'Dismiss getting started' }); if (await guide.isVisible()) await guide.click();
  };
  const exportGraph = async () => {
    await page.getByRole('button', { name: 'Data options', exact: true }).click();
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export graph JSON', exact: true }).click();
    const stream = await (await promise).createReadStream(); let text = ''; for await (const chunk of stream!) text += chunk;
    return JSON.parse(text);
  };
  await importGraph(JSON.stringify(fixture));
  await page.getByRole('button', { name: 'Switch to 2D view', exact: true }).click();
  await expect(page.getByRole('application', { name: /Interactive 2D/ })).toBeVisible();
  await page.getByRole('button', { name: 'Show graph filters', exact: true }).click();
  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  const fingerprintFilter = page.getByRole('button', { name: 'sounds alike', exact: true });
  await fingerprintFilter.click(); await expect(fingerprintFilter).toHaveAttribute('aria-pressed', 'true');
  await fingerprintFilter.click(); await page.getByRole('button', { name: 'Hide graph filters', exact: true }).click();
  const guitar = 'sc-a943c8b6ab615fcb';
  await page.getByRole('button', { name: 'Search documents', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(guitar) }).click();
  await expect(page.locator('.audio-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  const showAll = page.getByRole('button', { name: /Show all \d+ connections/ }); if (await showAll.isVisible()) await showAll.click();
  await expect(page.locator('.side-panel')).toContainText('guitar: model estimate / model estimate');
  await expect(page.locator('.side-panel')).toContainText('Model similarity is not a listening judgment');
  await expect(page.locator('.side-panel')).toContainText('not proof of exact duplicates');
  await page.locator('.connection-row').filter({ hasText: 'Nearby audio fingerprints' }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('licensed-pair-explanations.png') });
  const exported = await exportGraph();
  expect(exported.edges).toEqual(fixture.edges);
  expect(exported.edges.some((e: { kind: string }) => e.kind === 'tempo' || e.kind === 'key')).toBe(false);
  await page.reload(); await importGraph(JSON.stringify(exported));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'glass-dark');
  const restored = await exportGraph();
  expect(restored.edges).toEqual(exported.edges);
  expect(restored.nodes.map((n: { id: string }) => n.id)).toEqual(exported.nodes.map((n: { id: string }) => n.id));
  expect(errors).toEqual([]);
});
