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

function boundaryGraphJson(nodeCount: number): string {
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const ordinal = String(index + 1).padStart(4, '0');
    return {
      id: `boundary-${ordinal}`,
      kind: 'document',
      title: `Boundary node ${ordinal}`,
      fileType: 'txt',
      topics: [],
      entities: [],
      keywords: [],
      wordCount: 1,
      cluster: 0,
      degree: 0,
      status: 'ok',
    };
  });
  return JSON.stringify({
    version: 1,
    createdAt: '2026-09-06T00:00:00.000Z',
    generator: 'knowledge-nebula',
    includeEmbeddings: false,
    nodes,
    edges: [],
  });
}

async function importGraphJson(page: Page, json: string): Promise<void> {
  await page.getByRole('button', { name: 'Import a graph' }).click();
  const input = page.locator('input[type="file"][accept*=".json"]');
  await expect(input).toHaveCount(1);
  await input.evaluate((element, contents) => {
    const fileInput = element as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([contents], 'boundary-graph.json', { type: 'application/json' }));
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: transfer.files,
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  }, json);
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
  // Pinning the exact count makes silent ingest drops fail loudly. The
  // navigator itself only mounts at phase 'ready' (App.tsx), so reaching this
  // means parse + lexical + embedding + clustering all finished — asserting a
  // ready-only toolbar control too keeps that guarantee from resting on one
  // component's mount condition.
  await expect(page.locator('.graph-navigator__summary')).toContainText('100 documents', {
    timeout: 270_000,
  });
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeVisible();
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

  // Selection commits inside the WebGL frame loop; SwiftShader frames can
  // take seconds each, so these two waits get their own generous budget.
  const frameBudget = { timeout: 150_000 };
  const sidePanel = page.locator('.side-panel[role="dialog"]');
  await expect(sidePanel).toBeVisible(frameBudget);
  await page.getByRole('button', { name: 'Back to graph' }).click();
  await expect(sidePanel).toHaveCount(0);

  // Selection path 2: search overlay in browse mode (empty query lists all
  // documents with no dependency on the embedding model being warm). Opened
  // via the keyboard shortcut: at this small viewport the graph-navigator
  // panel overlaps the toolbar's search button, and the hotkey is the more
  // realistic entry point anyway.
  await page.keyboard.press('Control+k');
  const searchDialog = page.getByRole('dialog', { name: 'Search documents' });
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(sidePanel).toBeVisible(frameBudget);
  await page.getByRole('button', { name: 'Back to graph' }).click();

  // Hygiene: no console errors, no uncaught page errors, no error toasts.
  await expect(page.locator('.toast--error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('renderer grows past 4,096 nodes and can frame the first node beyond the old cap', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/');
  await expect(page.locator('.webgl-fallback')).toHaveCount(0);
  await importGraphJson(page, boundaryGraphJson(4_097));

  // 4,097 is deliberate: it forces the slot allocator to grow past the old
  // InstancedMesh capacity and makes Nodes remount its core/halo meshes.
  await expect(page.locator('.graph-navigator__summary')).toContainText('4097 documents', {
    timeout: 120_000,
  });
  await expect(page.locator('.nebula-canvas canvas')).toBeVisible();

  // The accessible navigator is store-backed, but focusNode only commits the
  // reader after the camera controller can frame the requested layout slot.
  // Targeting the final node therefore verifies that a post-growth slot made
  // it through layout -> position buffer -> scene/camera, rather than merely
  // existing in graphStore.
  const listbox = page.getByRole('listbox', { name: 'Graph nodes' });
  await listbox.focus();
  await page.keyboard.press('End');
  await expect(listbox).toHaveAttribute('aria-activedescendant', 'graph-navigator-option-4096');
  await page.keyboard.press('Enter');

  const sidePanel = page.locator('.side-panel[role="dialog"]');
  await expect(sidePanel).toBeVisible({ timeout: 180_000 });
  await expect(sidePanel).toContainText('Boundary node 4097');

  await expect(page.locator('.toast--error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
