import { test, expect } from '@playwright/test';
import { openFiles, openTab } from './resonance';

test('file browsing is visible and mobile guidance clears the controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').evaluate(element => {
    const graph = {
      version: 1, generator: 'knowledge-nebula', createdAt: '2026-10-03T00:00:00.000Z',
      includeEmbeddings: false,
      nodes: [{ id: 'layout-note', title: 'Layout note', kind: 'document', fileType: 'txt',
        topics: [], entities: [], keywords: [], wordCount: 1, cluster: 0, degree: 0, status: 'ok' }],
      edges: [],
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(graph)], 'layout.json', { type: 'application/json' }));
    Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The library list lives in its own view tab now, at both sizes.
  const library = page.getByRole('button', { name: 'Library', exact: true });
  await expect(library).toBeInViewport();
  await openFiles(page);
  await expect(page.getByRole('option', { name: /Layout note/ })).toBeVisible();
  await openTab(page, 'Graph');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(library).toBeInViewport();
  await openFiles(page);
  await expect(page.getByRole('option', { name: /Layout note/ })).toBeInViewport();
  await openTab(page, 'Graph');
  const guide = page.locator('.first-run-guide');
  await expect(guide).toBeVisible();
  const box = await guide.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(744);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Chat and the sample assistant both stay reachable and must not overlap.
  const chat = page.getByRole('button', { name: 'Ask about your library', exact: true });
  const assistantBox = await page.locator('.rs-assistant').boundingBox();
  const chatBox = await chat.boundingBox();
  expect(chatBox!.y + chatBox!.height).toBeLessThanOrEqual(assistantBox!.y);
  await chat.click();
  await expect(page.getByRole('button', { name: 'Close chat', exact: true })).toBeVisible();
});
