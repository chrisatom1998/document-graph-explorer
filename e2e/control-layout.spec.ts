import { test, expect } from '@playwright/test';
import { importGraphJson, openLibrary, showGraph } from './resonance';

test('library browsing is reachable and mobile guidance clears the controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await importGraphJson(page, JSON.stringify({
    version: 1, generator: 'knowledge-nebula', createdAt: '2026-10-03T00:00:00.000Z',
    includeEmbeddings: false,
    nodes: [{ id: 'layout-note', title: 'Layout note', kind: 'document', fileType: 'txt',
      topics: [], entities: [], keywords: [], wordCount: 1, cluster: 0, degree: 0, status: 'ok' }],
    edges: [],
  }), 'layout.json');
  const library = page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Library', exact: true });
  await expect(library).toBeInViewport();
  await expect(library).toBeEnabled();
  await openLibrary(page, { keepGuide: true });
  await expect(page.getByRole('option', { name: /Layout note/ })).toBeVisible();
  await showGraph(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(library).toBeInViewport();
  await openLibrary(page, { keepGuide: true });
  await expect(page.getByRole('option', { name: /Layout note/ })).toBeInViewport();
  await showGraph(page);
  const guide = page.locator('.first-run-guide');
  await expect(guide).toBeVisible();
  const box = await guide.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(744);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The import row keeps its three actions side by side on a phone.
  const importClips = page.getByRole('button', { name: /^Import files/ });
  const assistant = page.getByRole('button', { name: /^Sample assistant/ });
  await expect(importClips).toBeInViewport();
  await expect(assistant).toBeInViewport();
  const importBox = await importClips.boundingBox();
  const assistantBox = await assistant.boundingBox();
  expect(assistantBox!.x).toBeGreaterThanOrEqual(importBox!.x + importBox!.width);
  const chat = page.getByRole('button', { name: 'Ask about your library', exact: true });
  await expect(chat).toBeInViewport();
  await chat.click();
  await expect(page.getByRole('button', { name: 'Close chat', exact: true })).toBeVisible();
});
