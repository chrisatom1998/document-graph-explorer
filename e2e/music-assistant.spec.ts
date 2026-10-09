import { test, expect } from '@playwright/test';

const fixture = JSON.stringify({ version: 1, generator: 'knowledge-nebula', createdAt: '2026-10-02T00:00:00.000Z', includeEmbeddings: false,
  nodes: ['Vocal chop', 'Bass loop', 'Piano phrase'].map((title, i) => ({ id: `sound-${i}`, title, kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: i, status: 'ok',
    audio: { version: 2, analyzedSeconds: 4, durationSeconds: i === 2 ? 20 : 4, tempo: { bpm: i === 2 ? 92 : 140, confidence: .9 }, instruments: [], notes: [], confirmedDjTags: { source: [i === 0 ? 'voice' : i === 1 ? 'bass guitar' : 'piano'], production: i === 0 ? ['vocal chops'] : [], character: [] } } })), edges: [] });

test('integrated music assistant preserves the classic graph and works on mobile', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1168, height: 792 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').evaluate((element, contents) => {
    const files = new DataTransfer(); files.items.add(new File([contents], 'music-fixture.json', { type: 'application/json' }));
    Object.defineProperty(element, 'files', { configurable: true, value: files.files }); element.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
  const guide = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await guide.isVisible()) await guide.click();
  await page.getByRole('button', { name: /Sample assistant/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Find your next sound.' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Upload overview' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Speak your request' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Correct tags' }).first()).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('simple-library-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('textbox', { name: 'Describe the sound' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('simple-library-mobile.png') });
  await page.setViewportSize({ width: 1168, height: 792 });
  await dialog.getByRole('article').first().getByText('More', { exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Correct tags' }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Correct tags' }).first().click();
  await expect(dialog.getByText('Correct DJ tags', { exact: true })).toBeVisible();
  await dialog.getByText('Search options', { exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Compare with a sound' })).toBeVisible();
  await dialog.getByText('Search options', { exact: true }).click();
  // In the production app there is no local AI API, so local filters start open.
  await expect(dialog.locator('.dj-local-filters')).toHaveAttribute('open', '');
  await expect(dialog.getByLabel('Maximum seconds')).toBeVisible();
  await dialog.getByLabel('Maximum seconds').fill('5');
  await dialog.getByRole('button', { name: 'Apply local filters' }).click();
  await expect(dialog.getByRole('article')).toHaveCount(2);
  await dialog.getByRole('button', { name: '+ Add to crate', exact: true }).first().click();
  await dialog.getByRole('button', { name: 'View crate', exact: true }).click();
  await expect(dialog.getByRole('article')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export crate', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('dj-sample-crate.json');
  await dialog.getByText('Tools', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Upload overview', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Your upload at a glance' })).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('music-overview-desktop.png') });
  await dialog.getByRole('button', { name: 'Review this sound', exact: true }).first().click();
  await expect(dialog.getByText('1 / 5 selected', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Review model')).toHaveValue('audio');
  await expect(dialog.getByText(/uploads the first 10 seconds/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('music-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('music-review-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await dialog.getByRole('button', { name: 'Close sample assistant' }).click();
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});
