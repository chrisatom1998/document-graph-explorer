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

test('demo corpus ingests end-to-end and nodes open the reader panel', async ({ page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath('demo-graph.png') });

  // Selection path 1: the accessible graph navigator (pure DOM listbox) —
  // deterministic node selection without touching canvas pixels.
  const listbox = page.getByRole('listbox', { name: 'Graph nodes' });
  await page.getByRole('button', { name: 'Browse documents' }).click();
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
  // via the keyboard shortcut to also cover the global search entry point.
  await page.keyboard.press('Control+k');
  const searchDialog = page.getByRole('dialog', { name: 'Search documents' });
  await expect(searchDialog).toBeVisible();
  await expect(searchDialog.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(sidePanel).toBeVisible(frameBudget);
  await page.getByRole('button', { name: 'Back to graph' }).click();

  // Search passages in PDFs must be readable/selectable as actual text. The
  // same annotated demo must survive reload, including without a user file.
  const openPostgres = async () => {
    await page.getByRole('button', { name: 'Search documents' }).click();
    await page.getByRole('combobox').fill('Postgres Performance Tuning Guide');
    await page.getByRole('option', { name: /^Postgres Performance Tuning Guide/ }).click();
    await expect(sidePanel).toBeVisible(frameBudget);
    await expect(sidePanel.getByRole('button', { name: 'Extracted text', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(sidePanel.locator('.side-panel__reader')).toContainText('pg_stat_statements');
    await sidePanel.getByRole('button', { name: 'About', exact: true }).click();
  };
  await openPostgres();
  await page.screenshot({ path: testInfo.outputPath('pdf-extracted-text.png') });
  await page.getByRole('textbox', { name: 'Document note' }).fill('Persistence regression note');
  await page.getByRole('textbox', { name: 'Add a tag' }).fill('regression');
  await page.getByRole('textbox', { name: 'Add a tag' }).press('Enter');
  await page.getByRole('button', { name: 'Back to graph' }).click();
  await page.reload();
  await expect(page.locator('.graph-navigator__summary')).toContainText('100 documents');
  await openPostgres();
  await expect(page.getByRole('textbox', { name: 'Document note' })).toHaveValue('Persistence regression note');
  await expect(page.getByRole('button', { name: 'Remove tag regression' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to graph' }).click();

  await page.getByRole('button', { name: 'Add documents', exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await (await chooserPromise).setFiles('e2e/fixtures/persistence.txt');
  await expect(page.locator('.graph-navigator__summary')).toContainText('101 documents');
  await page.reload();
  await expect(page.locator('.graph-navigator__summary')).toContainText('101 documents');

  // Hygiene: no console errors, no uncaught page errors, no error toasts.
  await expect(page.locator('.toast--error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('normal-motion navigation and title-only Unicode search work after import', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') {
      externalRequests.push(url.href);
    }
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const graph = JSON.parse(boundaryGraphJson(3));
  graph.nodes[1].title = '東京 計画 📚';
  graph.nodes[2].title = 'مرحبا بالعالم';
  await importGraphJson(page, JSON.stringify(graph));
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Browse documents' }).click();
  const list = page.getByRole('listbox', { name: 'Graph nodes' });
  await list.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  const panel = page.locator('.side-panel[role="dialog"]');
  await expect(panel).toContainText('Boundary node 0001', { timeout: 150_000 });
  await page.getByRole('button', { name: 'Back to graph' }).click();
  await page.getByRole('button', { name: 'Search documents' }).click();
  await page.getByRole('combobox').fill('東京');
  await page.getByRole('option', { name: /東京 計画/ }).click();
  await expect(panel).toContainText('東京 計画', { timeout: 150_000 });
  await page.getByRole('button', { name: 'Back to graph' }).click();
  await page.getByRole('button', { name: 'Fit the whole graph in view' }).click();
  await page.screenshot({ path: testInfo.outputPath('unicode-graph.png') });
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('search ranks within file filters before applying its result limit', async ({ page }) => {
  await page.goto('/');
  const graph = JSON.parse(boundaryGraphJson(14));
  graph.nodes.forEach((node: { title: string; fileType: string }, index: number) => {
    node.title = `Architecture ${String(index).padStart(2, '0')}`;
    node.fileType = index === 13 ? 'md' : 'txt';
  });
  await importGraphJson(page, JSON.stringify(graph));
  await page.getByRole('button', { name: 'Dismiss getting started' }).click();
  await page.getByRole('button', { name: 'Show graph filters' }).click();
  await page.getByRole('button', { name: 'md · 1', exact: true }).click();
  await page.getByRole('button', { name: 'Search documents' }).click();
  await page.getByRole('combobox').fill('Architecture');
  await expect(page.getByRole('option', { name: /Architecture 13/ })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(1);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`workspace controls remain usable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('welcome.png') });
    await importGraphJson(page, boundaryGraphJson(3));
    const browse = page.getByRole('button', { name: 'Browse documents' });
    await expect(browse).toBeVisible();
    const toolbar = await page.locator('.toolbar').boundingBox();
    const navigator = await page.locator('.graph-navigator').boundingBox();
    expect(toolbar).not.toBeNull();
    expect(navigator).not.toBeNull();
    expect(navigator!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height);
    await browse.click();
    const list = page.getByRole('listbox', { name: 'Graph nodes' });
    await expect(list).toBeVisible();
    // The open browser must not intercept the primary search action.
    await page.getByRole('button', { name: 'Search documents' }).click();
    await expect(page.getByRole('dialog', { name: 'Search documents' })).toBeVisible();
    const searchInput = page.getByRole('combobox');
    await expect(searchInput).toBeFocused();
    await searchInput.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search documents' })).toBeHidden();
    const tour = page.getByRole('button', { name: 'Dismiss getting started' });
    await expect(tour).toBeVisible();
    await browse.click();
    await list.focus();
    await page.keyboard.press('Escape');
    await expect(browse).toBeFocused();
    await expect(list).toBeHidden();
    await expect(tour).toBeVisible();
    await page.getByRole('button', { name: 'Show graph filters' }).click();
    if (viewport.width < 640) {
      const filters = await page.locator('#graph-filter-panel').boundingBox();
      expect(filters!.y).toBeGreaterThanOrEqual(navigator!.y + navigator!.height);
    }
    await page.getByRole('button', { name: 'More filters' }).click();
    const minimum = page.getByRole('slider', { name: 'Minimum document connections' });
    await minimum.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#graph-filter-status')).toHaveText('0 documents match');
    await expect(page.getByText(/No documents match/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('filters.png') });
    await minimum.press('Escape');
    await expect(page.getByRole('button', { name: 'Show graph filters' })).toHaveAttribute('aria-expanded', 'false');
    await expect(tour).toBeVisible();
    if (viewport.width < 640) {
      const summary = await page.locator('.filter-bar__active-summary').boundingBox();
      expect(summary!.y).toBeGreaterThanOrEqual(navigator!.y + navigator!.height);
    }
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.locator('#graph-filter-status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show graph filters' })).toHaveText('Filters');
  });
}

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
  await page.getByRole('button', { name: 'Browse documents' }).click();
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
