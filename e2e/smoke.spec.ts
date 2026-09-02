import { test, expect, type Page } from '@playwright/test';

// Console/page-error hygiene: the app funnels failures into toasts, so a
// clean console AND no error toast together prove the run was healthy.
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`));
  return errors;
}

test('first run renders the empty state with a working WebGL scene', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Turn scattered files into a living map.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load demo corpus' })).toBeVisible();

  // If WebGL context creation failed, the scene mounts a fallback section
  // instead of the canvas — fail loudly here rather than timing out later.
  await expect(page.locator('.webgl-fallback')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('demo corpus ingests end-to-end and nodes open the reader panel', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await expect(page.locator('.webgl-fallback')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load demo corpus' }).click();

  // The navigator summary is simultaneously the ingest-complete signal and
  // proof of real graph data: 36 committed + 64 generated PDFs = 100 docs.
  // Pinning the exact count makes silent ingest drops fail loudly.
  await expect(page.locator('.graph-navigator__summary')).toContainText('100 documents', {
    timeout: 270_000,
  });
  await expect(page.locator('.nebula-canvas canvas')).toBeVisible();

  // The getting-started tour reopens after a demo load; dismiss it so
  // keyboard-driven steps below reach the app, not the tour's handlers.
  const tour = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await tour.isVisible().catch(() => false)) {
    await tour.click();
  }

  // Selection path 1: the accessible graph navigator (pure DOM listbox) —
  // deterministic node selection without touching canvas pixels.
  const listbox = page.getByRole('listbox', { name: 'Graph nodes' });
  await listbox.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  const sidePanel = page.locator('.side-panel[role="dialog"]');
  await expect(sidePanel).toBeVisible();
  await page.getByRole('button', { name: 'Back to graph' }).click();
  await expect(sidePanel).toHaveCount(0);

  // Selection path 2: search overlay in browse mode (empty query lists all
  // documents with no dependency on the embedding model being warm).
  await page.getByRole('button', { name: 'Search documents' }).click();
  const searchDialog = page.getByRole('dialog', { name: 'Search documents' });
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(sidePanel).toBeVisible();
  await page.getByRole('button', { name: 'Back to graph' }).click();

  // Hygiene: no console errors, no uncaught page errors, no error toasts.
  await expect(page.locator('.toast--error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
