import { test, expect } from '@playwright/test';

test('persistent performance toast leaves the toolbar usable at compact sizes', async ({ page }) => {
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 800, height: 500 });
  // Exercise the real performance warning and ToastHost. Slow frame delivery
  // deterministically instead of depending on the CI machine's GPU speed.
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => requestFrame(() => {
      window.setTimeout(() => callback(performance.now()), 65);
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a graph' }).click();
  await page.locator('input[type="file"][accept*=".json"]').evaluate(element => {
    const graph = {
      version: 1, createdAt: '2026-10-02T00:00:00.000Z', generator: 'knowledge-nebula',
      includeEmbeddings: false,
      nodes: Array.from({ length: 21 }, (_, index) => ({ id: `toast-node-${index}`, kind: 'document', title: `Cedar${index}`, fileType: 'txt', topics: [], entities: [], keywords: [], wordCount: 1, cluster: 0, degree: 0, status: 'ok' })),
      edges: [],
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(graph)], 'toast-graph.json', { type: 'application/json' }));
    Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const action = page.getByRole('button', { name: 'Switch to 2D', exact: true });
  await expect(action).toBeVisible({ timeout: 60_000 });
  for (const viewport of [{ width: 800, height: 500 }, { width: 390, height: 500 }]) {
    await page.setViewportSize(viewport);
    const toolbar = page.locator('.workspace-header');
    const toast = page.locator('.toast-host');
    await expect(action).toBeInViewport();
    const toolbarBox = await toolbar.boundingBox();
    const toastBox = await toast.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(toastBox).not.toBeNull();
    expect(toastBox!.y).toBeGreaterThan(toolbarBox!.y + toolbarBox!.height);
    const transportBox = await page.locator('#workspace-transport').boundingBox();
    expect(transportBox).not.toBeNull();
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(transportBox!.y);
    await page.getByRole('button', { name: 'Add documents', exact: true }).click({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeVisible();
    // Close through the same toggle before resizing. Frame throttling can
    // postpone the menu's Escape-listener effect after its first paint.
    await page.getByRole('button', { name: 'Add documents', exact: true }).click({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Add documents', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Add files', exact: true })).toHaveCount(0);
    await expect(action).toBeVisible();
  }
  // The action remains interactive as well as visible; no force clicks or
  // dismissals hide the toolbar regression above.
  await action.click({ timeout: 5000 });
  await expect(action).toHaveCount(0);
});
