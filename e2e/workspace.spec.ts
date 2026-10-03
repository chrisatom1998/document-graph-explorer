import { test, expect } from '@playwright/test';

// Small explicit fixture: visual checks need no external models or private samples.
const fixture = JSON.stringify({
  version: 1, generator: 'knowledge-nebula', createdAt: '2026-10-02T00:00:00.000Z', includeEmbeddings: false,
  clusterNames: { 0: 'Synths', 1: 'Bass', 2: 'Percussion' },
  nodes: Array.from({ length: 12 }, (_, i) => ({
    id: `studio-${i}`, title: `${i % 3 === 0 ? 'Melodic' : i % 3 === 1 ? 'Bass' : 'Rhythm'} ${String(i + 1).padStart(2, '0')}`,
    kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, cluster: i % 3, degree: 2, status: 'ok',
    audio: { version: 2, analyzedSeconds: 12, durationSeconds: 12, tempo: { bpm: i < 8 ? 140 : 92, confidence: .8 }, key: { tonic: 3, mode: 'minor', strength: .8 }, instruments: [], confirmedInstruments: [i % 3 === 0 ? 'synthesizer' : i % 3 === 1 ? 'bass guitar' : 'drum kit'], notes: [] },
  })),
  edges: Array.from({ length: 12 }, (_, i) => ({ id: `edge-${i}`, source: `studio-${i}`, target: `studio-${(i + 1) % 12}`, kind: 'key', weight: .8, evidence: ['Same test key'] })),
});

test('classic graph controls and music copilot work on desktop and mobile', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').evaluate((element, contents) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([contents], 'Design test library.json', { type: 'application/json' }));
    Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
  await expect(page.locator('.toolbar').getByRole('button', { name: /^Current corpus:/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Show graph filters' }).click();
  await expect(page.getByRole('button', { name: 'More filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide graph filters' }).click();
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Corpus insights', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View options' }).click();
  await expect(page.getByRole('button', { name: 'Save current view', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Graph clarity', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Chat provider', exact: true })).toBeHidden();
  await page.getByText('AI connections (optional)', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Chat provider', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Browse documents', exact: true }).press('Space');
  await page.getByRole('option', { name: /Melodic 01/ }).click();
  await expect(page.getByRole('dialog', { name: 'Melodic 01', exact: true })).toBeVisible();
  await expect(page.getByText('Estimated tempo', { exact: true })).toBeVisible();
  await expect(page.locator('.audio-controls--preview')).toBeVisible();
  await expect(page.locator('.audio-controls--preview').getByRole('button', { name: 'Play sample' })).toBeDisabled();
  await expect(page.getByText('Audio is not saved here. Add the original file again to play it.')).toBeVisible();
  await expect(page.locator('.toolbar').getByRole('button', { name: 'Search documents' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to graph', exact: true }).click();
  await page.getByRole('button', { name: 'Fit the whole graph in view' }).click();
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') });

  await page.getByRole('button', { name: 'Chat with your documents' }).click();
  await expect(page.getByRole('dialog', { name: 'Music copilot', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search, review & build crates ↗' })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('workspace-copilot-start.png') });
  await page.getByRole('button', { name: 'Find matching samples', exact: true }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.chat-bubble--assistant')).toContainText('Matches for');
  await expect(page.locator('.chat-bubble--assistant')).toContainText('confirmed by you');
  await page.getByRole('button', { name: 'Show samples in graph', exact: true }).click();
  await expect(page.locator('.side-panel')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('workspace-copilot.png') });
  await page.getByRole('button', { name: 'Close chat', exact: true }).click();

  await page.getByRole('button', { name: 'Switch to 2D view', exact: true }).click();
  await expect(page.getByRole('application', { name: /Interactive 2D/ })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to 3D view', exact: true }).click();
  await expect(page.getByRole('application', { name: /Interactive 3D/ })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Browse documents' }).press('Space');
  await expect(page.getByRole('listbox', { name: 'Graph nodes' })).toBeVisible();
  await page.getByRole('button', { name: 'Browse documents' }).press('Escape');
  await page.getByRole('button', { name: 'Chat with your documents' }).click();
  await expect(page.getByRole('dialog', { name: 'Music copilot', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close chat', exact: true }).click();
  await page.getByRole('button', { name: 'Fit the whole graph in view' }).click();
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
