import { test, expect } from '@playwright/test';

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
  const browse = page.getByRole('button', { name: 'Browse documents', exact: true });
  await expect(browse).toBeInViewport();
  await expect(page.locator('.graph-navigator')).toHaveCSS('opacity', '1');
  await browse.click();
  await expect(page.getByRole('option', { name: /Layout note/ })).toBeVisible();
  await browse.click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(browse).toBeInViewport();
  await browse.click();
  await expect(page.getByRole('option', { name: /Layout note/ })).toBeInViewport();
  await browse.click();
  const guide = page.locator('.first-run-guide');
  await expect(guide).toBeVisible();
  const box = await guide.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(744);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const chat = page.getByRole('button', { name: 'Chat with your documents', exact: true });
  const assistantBox = await page.locator('.dj-launch').boundingBox();
  const chatBox = await chat.boundingBox();
  expect(chatBox!.x).toBeGreaterThan(assistantBox!.x + assistantBox!.width);
  await chat.click();
  await expect(page.getByRole('button', { name: 'Close chat', exact: true })).toBeVisible();
});
