import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { countText, dismissGuide, openLibrary, openTool, pickFolder, projectCount, showGraph } from './resonance';

function tone(frequency: number) {
  const wav = Buffer.alloc(44 + 16000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 16000; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i * 2 * Math.PI * frequency / 16000)), 44 + i * 2);
  return wav;
}

// Resonance palette: --rs-bg #0b0b11 on the page, --rs-panel #0e0e15 on the top bar.
const PAGE_BACKGROUND = 'rgb(11, 11, 17)';
const TOP_BAR_BACKGROUND = 'rgb(14, 14, 21)';

test('real folder chooser imports nested audio, supports re-selection, and the dark interface survives reload', async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(30000);
  // Hold the real text embedding download until the in-progress UI is exercised.
  // Audio Quick mode has a deadline, so gating its decoder cannot keep the
  // processing strip alive deterministically on a slow software renderer.
  let embeddingRequested = false;
  let releaseEmbedding!: () => void;
  const embeddingGate = new Promise<void>(resolve => { releaseEmbedding = resolve; });
  await context.route('**/models/Xenova/bge-small-en-v1.5/onnx/*.onnx', async route => {
    embeddingRequested = true;
    await embeddingGate;
    await route.continue();
  });
  try {
    const folder = testInfo.outputPath('Folder upload');
    await mkdir(join(folder, 'Nested'), { recursive: true });
    await writeFile(join(folder, 'First tone.wav'), tone(440));
    await writeFile(join(folder, 'Nested', 'Second tone.wav'), tone(660));
    await writeFile(join(folder, 'Readme.txt'), 'Two generated tones for the folder import and playback regression.');
    await writeFile(join(folder, '.DS_Store'), 'ignored');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'fast' }));
      // Reproduce embedded browsers which expose an unusable directory API.
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: () => Promise.reject(new DOMException('Unavailable here', 'SecurityError')) });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('body')).toHaveCSS('background-color', PAGE_BACKGROUND);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^Add a folder/ }).click();
    await (await chooserPromise).setFiles(folder);
    await expect.poll(() => embeddingRequested, { timeout: 120000 }).toBe(true);
    // The graph scene builds right after import. Under software WebGL that holds the main
    // thread for several 10-20s stretches (about 45s in total in CI traces), and a click
    // waits on animation frames to judge the button stable, so this exchange needs a
    // budget wider than the 30s default or it times out inside the freeze.
    const sceneBuild = { timeout: 120000 };
    await page.getByRole('button', { name: 'Minimize processing details' }).click(sceneBuild);
    await expect(page.getByRole('button', { name: 'Show processing details' })).toBeVisible(sceneBuild);
    await page.getByRole('button', { name: 'Show processing details' }).click(sceneBuild);
    await expect(page.getByRole('button', { name: 'Minimize processing details' })).toBeVisible(sceneBuild);
    await page.getByRole('button', { name: 'Minimize processing details' }).click(sceneBuild);
    await expect(page.getByRole('button', { name: 'Search documents' })).toBeDisabled();
    releaseEmbedding();
    await expect(projectCount(page)).toHaveText(countText(3), { timeout: 120000 });
    await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
    await page.getByRole('button', { name: 'Ask about your library', exact: true }).click();
    const copilot = page.getByRole('dialog', { name: 'Music copilot', exact: true });
    await expect(copilot).toBeVisible();
    await copilot.getByRole('button', { name: 'Explore my library' }).click();
    await copilot.getByRole('button', { name: 'Send message' }).click();
    await expect(copilot.getByText(/Your collection contains/)).toBeVisible();
    await copilot.getByRole('button', { name: 'Close chat', exact: true }).click();
    releaseEmbedding();
    await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
    // The audio analysis strip may finish (and unmount) between the check and the click.
    const minimizeAnalysis = page.getByRole('button', { name: 'Minimize audio analysis' });
    if (await minimizeAnalysis.isVisible()) await minimizeAnalysis.click({ timeout: 5000 }).catch(() => undefined);
    await dismissGuide(page);
    const list = await openLibrary(page);
    await list.getByRole('option', { name: /Second tone/i }).click();
    await expect(page.locator('.audio-preview')).toBeVisible();
    await expect(page.locator('.side-panel audio')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('.rs-top')).toHaveCSS('background-color', TOP_BAR_BACKGROUND);
    await expect(page.locator('.side-panel')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('dark-workspace.png') });
    await page.getByRole('button', { name: 'Ask about your library', exact: true }).click();
    await copilot.getByText('More tools', { exact: true }).click();
    await copilot.getByRole('button', { name: 'Search, review & build crates ↗' }).click();
    await expect(page.locator('.dj-dialog')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('dark-assistant.png') });
    await page.getByRole('button', { name: 'Close sample assistant' }).click();
    // Exercise the sidebar's folder import too, and ensure repeated folder selection is handled.
    await writeFile(join(folder, 'Third tone.wav'), tone(880));
    await pickFolder(page, folder);
    await expect(projectCount(page)).toHaveText(countText(4), { timeout: 120000 });
    await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', PAGE_BACKGROUND);
    await expect(projectCount(page)).toHaveText(countText(4));
    await page.setViewportSize({ width: 390, height: 844 });
    await openLibrary(page);
    await page.screenshot({ path: testInfo.outputPath('resonance-mobile.png') });
    await showGraph(page);
    await openTool(page, 'Settings');
    await expect(page.getByLabel('Graph clarity', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  } finally {
    releaseEmbedding();
  }
});
