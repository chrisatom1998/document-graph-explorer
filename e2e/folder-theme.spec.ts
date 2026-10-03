import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function tone(frequency: number) {
  const wav = Buffer.alloc(44 + 16000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 16000; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i * 2 * Math.PI * frequency / 16000)), 44 + i * 2);
  return wav;
}

test('real folder chooser imports nested audio, supports re-selection, and dark mode persists', async ({ page, context }, testInfo) => {
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
    await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'dark');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^Add a folder/ }).click();
    await (await chooserPromise).setFiles(folder);
    await expect(page.getByRole('button', { name: 'All files 3', exact: true })).toBeVisible({ timeout: 120000 });
    await expect.poll(() => embeddingRequested, { timeout: 120000 }).toBe(true);
    await page.getByRole('button', { name: 'Minimize processing details' }).click();
    await expect(page.getByRole('button', { name: 'Show processing details' })).toBeVisible();
    await page.getByRole('button', { name: 'Show processing details' }).click();
    await expect(page.getByRole('button', { name: 'Minimize processing details' })).toBeVisible();
    await page.getByRole('button', { name: 'Minimize processing details' }).click();
    await expect(page.getByRole('button', { name: 'Search documents' })).toBeDisabled();
    await page.getByRole('button', { name: /Music copilot Find your next sound/ }).click();
    const copilot = page.getByRole('dialog', { name: 'Music copilot', exact: true });
    await expect(copilot).toBeVisible();
    await expect(copilot.getByText(/Analysis is still running/)).toBeVisible();
    await copilot.getByRole('button', { name: 'Explore my library' }).click();
    await copilot.getByRole('button', { name: 'Send message' }).click();
    await expect(copilot.getByText(/Your collection contains/)).toBeVisible();
    await copilot.getByRole('button', { name: 'Close chat', exact: true }).click();
    releaseEmbedding();
    await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
    const minimizeAnalysis = page.getByRole('button', { name: 'Minimize audio analysis' });
    if (await minimizeAnalysis.isVisible()) await minimizeAnalysis.click();
    const guide = page.getByRole('button', { name: 'Dismiss getting started' });
    if (await guide.isVisible()) await guide.click();
    await page.getByRole('button', { name: 'All files 3', exact: true }).click();
    await page.getByRole('option', { name: /Second tone/i }).click();
    await expect(page.locator('.audio-preview')).toBeVisible();
    await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
    await expect(page.locator('.workspace-header')).toHaveCSS('background-color', 'rgb(23, 28, 27)');
    await expect(page.locator('.side-panel')).toHaveCSS('background-color', 'rgb(23, 28, 27)');
    await page.screenshot({ path: testInfo.outputPath('dark-workspace.png') });
    await page.getByRole('button', { name: 'Music copilot Find your next sound' }).click();
    await page.getByText('More tools', { exact: true }).click();
    await page.getByRole('button', { name: 'Search, review & build crates ↗' }).click();
    await expect(page.locator('.dj-dialog')).toHaveCSS('background-color', 'rgb(23, 28, 27)');
    await page.screenshot({ path: testInfo.outputPath('dark-assistant.png') });
    await page.getByRole('button', { name: 'Close sample assistant' }).click();
    // Exercise the workspace menu too, and ensure repeated folder selection is handled.
    await writeFile(join(folder, 'Third tone.wav'), tone(880));
    await page.getByRole('button', { name: 'Add documents', exact: true }).click();
    const again = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add folder', exact: true }).click();
    await (await again).setFiles(folder);
    await expect(page.getByRole('button', { name: 'All files 4', exact: true })).toBeVisible({ timeout: 120000 });
    await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'dark');
    await expect(page.getByRole('button', { name: 'All files 4', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Toggle library', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('dark-mobile.png') });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Appearance', { exact: true }).selectOption('light');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'light');
    await expect(page.locator('.workspace-library')).toHaveCSS('background-color', 'rgb(248, 246, 242)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  } finally {
    releaseEmbedding();
  }
});
