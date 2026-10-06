import { expect, test, type Page } from '@playwright/test';
import { closeDetails, details, fitAll, openFiles, toolMenu } from './resonance';

const graph = JSON.stringify({
  version: 1, generator: 'knowledge-nebula', createdAt: '2026-10-02T00:00:00.000Z', includeEmbeddings: false,
  clusterNames: { 0: 'Synthesizers', 1: 'Bass sounds', 2: 'Percussion', 3: 'Textures' },
  nodes: Array.from({ length: 32 }, (_, i) => ({
    id: `resolution-${i}`, title: `${['Analog synth', 'Sub bass', 'Drum loop', 'Atmospheric texture'][i % 4]} ${String(i + 1).padStart(2, '0')}`,
    kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0,
    cluster: i % 4, degree: 3, status: 'ok',
  })),
  edges: Array.from({ length: 64 }, (_, i) => ({
    id: `link-${i}`, source: `resolution-${i % 32}`, target: `resolution-${(i + (i < 32 ? 4 : 1)) % 32}`,
    kind: 'semantic', weight: .8, evidence: ['Synthetic graph for rendering checks'],
  })),
});

async function loadGraph(page: Page, firstVisit = true) {
  if (firstVisit) await page.goto('/');
  await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').evaluate((element, contents) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([contents], 'Graph clarity test.json', { type: 'application/json' }));
    Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, graph);
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
}

async function pixelRatio(page: Page) {
  return page.locator('.nebula-canvas canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    return canvas.width / canvas.clientWidth;
  });
}

// Two animation frames commit a resize/view change before capturing pixels.
// Thirty frames needlessly multiplies software-rendering cost at DPR 4.
async function finishFrames(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    let count = 0;
    const frame = () => { if (++count === 2) resolve(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }));
}

test.describe('retina graph clarity', () => {
  // Keep DPR 3/4 assertions at full effects, but bound the raster area for
  // SwiftShader. Desktop layout is covered separately by workspace tests.
  test.use({ deviceScaleFactor: 2, viewport: { width: 800, height: 600 } });
  test('both views render sharply, remain interactive, and retain the clarity preference', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await loadGraph(page);
    await toolMenu(page, 'Settings');
    await expect(page.getByLabel('Graph clarity', { exact: true })).toHaveValue('high');
    // Hold full effects to make the numeric resolution check deterministic.
    await page.getByRole('checkbox', { name: 'Auto-adjust quality for smooth performance' }).uncheck();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect.poll(() => pixelRatio(page)).toBeCloseTo(3, 2);
    await finishFrames(page);
    await page.screenshot({ path: testInfo.outputPath('graph-3d-high.png') });

    await page.getByRole('button', { name: 'Switch to 2D view', exact: true }).click();
    await expect(page.getByRole('application', { name: /Interactive 2D/ })).toBeVisible();
    await expect.poll(() => pixelRatio(page)).toBeCloseTo(3, 2);
    await finishFrames(page);
    await page.screenshot({ path: testInfo.outputPath('graph-2d-high.png') });
    await openFiles(page);
    await page.getByRole('option', { name: /Analog synth 01/ }).click();
    await expect(details(page)).toContainText('Analog synth 01');
    await closeDetails(page);
    await fitAll(page);
    const canvas = await page.locator('.nebula-canvas canvas').boundingBox();
    await page.mouse.move(canvas!.x + 20, canvas!.y + 20);
    await page.mouse.down();
    await page.mouse.move(canvas!.x + 110, canvas!.y + 75, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, -180);
    await fitAll(page);

    await toolMenu(page, 'Settings');
    await page.getByLabel('Graph clarity', { exact: true }).selectOption('ultra');
    await expect.poll(() => pixelRatio(page)).toBeCloseTo(4, 2);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to 3D view', exact: true }).click();
    await expect.poll(() => pixelRatio(page)).toBeCloseTo(4, 2);
    await finishFrames(page);
    await page.screenshot({ path: testInfo.outputPath('graph-3d-ultra.png') });
    await page.reload();
    // Imported graphs are intentionally tab-local; the clarity preference
    // must survive independently and apply when another graph is opened.
    await loadGraph(page, false);
    await expect.poll(() => pixelRatio(page)).toBeCloseTo(4, 2);
    await toolMenu(page, 'Settings');
    await expect(page.getByLabel('Graph clarity', { exact: true })).toHaveValue('ultra');
    await page.getByRole('checkbox', { name: 'Auto-adjust quality for smooth performance' }).uncheck();
    await page.getByLabel('Graph clarity', { exact: true }).selectOption('performance');
    await expect.poll(() => pixelRatio(page)).toBeCloseTo(2, 2);
    await page.getByLabel('Graph clarity', { exact: true }).selectOption('high');
    await expect.poll(() => pixelRatio(page)).toBeCloseTo(3, 2);
    expect(errors).toEqual([]);
  });
});

test.describe('touchscreen graph clarity', () => {
  test.use({ deviceScaleFactor: 3, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('does not force a high-density touchscreen down to single-pixel resolution', async ({ page }, testInfo) => {
    await loadGraph(page);
    await expect.poll(() => pixelRatio(page)).toBeGreaterThanOrEqual(1.99);
    await page.getByRole('button', { name: 'Switch to 2D view', exact: true }).click();
    await expect(page.getByRole('application', { name: /Interactive 2D/ })).toBeVisible();
    await expect.poll(() => pixelRatio(page)).toBeGreaterThanOrEqual(1.99);
    await finishFrames(page);
    await page.screenshot({ path: testInfo.outputPath('graph-mobile-high.png') });
  });
});
