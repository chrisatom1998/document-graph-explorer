import { test, expect } from '@playwright/test';
import { importGraphJson } from './resonance';

test('persistent performance toast leaves the top bar usable at compact sizes', async ({ page }) => {
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 800, height: 500 });
  // Exercise the real performance warning and ToastHost. Slow frame delivery
  // deterministically instead of depending on the CI machine's GPU speed.
  // The warning offers "Switch to 2D", so start in 3D (a fresh profile
  // would otherwise open the flat map).
  await page.addInitScript(() => {
    localStorage.setItem('knowledge-nebula-dims', '3');
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => requestFrame(() => {
      window.setTimeout(() => callback(performance.now()), 65);
    });
  });
  await page.goto('/');
  await importGraphJson(page, JSON.stringify({
    version: 1, createdAt: '2026-10-02T00:00:00.000Z', generator: 'knowledge-nebula',
    includeEmbeddings: false,
    nodes: Array.from({ length: 21 }, (_, index) => ({ id: `toast-node-${index}`, kind: 'document', title: `Cedar${index}`, fileType: 'txt', topics: [], entities: [], keywords: [], wordCount: 1, cluster: 0, degree: 0, status: 'ok' })),
    edges: [],
  }), 'toast-graph.json');
  const toast = page.locator('.toast-host');
  const action = toast.getByRole('button', { name: 'Switch to 2D', exact: true });
  await expect(action).toBeVisible({ timeout: 60_000 });
  const more = page.getByRole('button', { name: 'More tools', exact: true });
  for (const viewport of [{ width: 800, height: 500 }, { width: 390, height: 500 }]) {
    await page.setViewportSize(viewport);
    const topBar = page.locator('.rs-top');
    await expect(action).toBeInViewport();
    const topBarBox = await topBar.boundingBox();
    const toastBox = await toast.boundingBox();
    expect(topBarBox).not.toBeNull();
    expect(toastBox).not.toBeNull();
    expect(toastBox!.y).toBeGreaterThan(topBarBox!.y + topBarBox!.height);
    expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(viewport.height);
    await more.click({ timeout: 5000 });
    await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
    // Close through the scrim (clicked clear of the menu itself) before
    // resizing. Frame throttling can postpone effects that run after the
    // menu's first paint.
    await page.getByRole('button', { name: 'Close menu', exact: true }).click({ position: { x: 2, y: 2 }, timeout: 5000 });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(action).toBeVisible();
  }
  // The action remains interactive as well as visible; no force clicks or
  // dismissals hide the top bar regression above.
  await action.click({ timeout: 5000 });
  await expect(action).toHaveCount(0);
  await expect(page.getByRole('application', { name: /Interactive 2D/ })).toBeVisible();
});
