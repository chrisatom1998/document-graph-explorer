import { test, expect } from '@playwright/test';
import { detailPanel, dismissGuide, fitAll, hideDetails, importGraphJson, openLibrary, openTool, showGraph, switchDims } from './resonance';

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

test('workspace controls and music copilot work on desktop and mobile', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await importGraphJson(page, fixture, 'Design test library.json');
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
  await dismissGuide(page);
  // The workspace switcher lives in the top bar once a graph exists.
  await expect(page.locator('.rs-top').getByRole('button', { name: /^Current corpus:/ })).toHaveCount(1);
  // The filter column reflects what the graph contains: key links and tempos.
  const filters = page.getByRole('complementary', { name: 'Filters' });
  await expect(filters.getByRole('checkbox', { name: 'Key', exact: true })).toBeEnabled();
  await expect(filters.getByRole('slider', { name: 'Minimum tempo' })).toBeEnabled();
  await expect(filters.getByRole('button', { name: 'Clear all', exact: true })).toBeDisabled();
  await openTool(page, 'Insights');
  await expect(page.getByRole('dialog', { name: 'Corpus insights', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Corpus insights', exact: true })).toHaveCount(0);
  await openTool(page, 'Settings');
  await expect(page.getByLabel('Graph clarity', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Chat provider', exact: true })).toBeHidden();
  await page.getByText('AI connections (optional)', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Chat provider', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const list = await openLibrary(page);
  await list.getByRole('option', { name: /Melodic 01/ }).click();
  const panel = page.getByRole('region', { name: 'Melodic 01', exact: true });
  await expect(panel).toBeVisible();
  // The inspector shows the selected clip and one connected clip with reasons.
  await expect(page.getByRole('region', { name: 'Selected clip', exact: true })).toContainText('Melodic 01');
  await expect(page.getByRole('region', { name: "Why they're connected", exact: true })).toContainText('Compatible key');
  await expect(panel.getByText('Tempo', { exact: true })).toBeVisible();
  await expect(panel.locator('.audio-controls--preview')).toBeVisible();
  await expect(panel.locator('.audio-controls--preview').getByRole('button', { name: 'Play sample' })).toBeDisabled();
  await expect(panel.getByText('Audio is not saved here. Add the original file again to play it.')).toBeVisible();
  await expect(page.locator('.rs-top').getByRole('button', { name: 'Search documents' })).toBeVisible();
  await hideDetails(page);
  await showGraph(page);
  await fitAll(page);
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') });

  // The selection survives collapsing the details, so the copilot can
  // answer a contextual match request for it.
  await page.getByRole('button', { name: 'Ask about your library', exact: true }).click();
  const copilot = page.getByRole('dialog', { name: 'Music copilot', exact: true });
  await expect(copilot).toBeVisible();
  await expect(copilot.getByRole('button', { name: 'Search, review & build crates ↗' })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('workspace-copilot-start.png') });
  await copilot.getByRole('button', { name: 'Find matching samples', exact: true }).click();
  await copilot.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.chat-bubble--assistant')).toContainText('Matches for');
  await expect(page.locator('.chat-bubble--assistant')).toContainText('confirmed by you');
  await copilot.getByRole('button', { name: 'Show samples in graph', exact: true }).click();
  // Showing matches clears the selection, which empties the inspector.
  await expect(detailPanel(page)).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Connected clips' })).toContainText('Pick a clip');
  await page.screenshot({ path: testInfo.outputPath('workspace-copilot.png') });
  await copilot.getByRole('button', { name: 'Close chat', exact: true }).click();

  await switchDims(page, 3);
  await switchDims(page, 2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(await openLibrary(page)).toBeVisible();
  await showGraph(page);
  await page.getByRole('button', { name: 'Ask about your library', exact: true }).click();
  await expect(copilot).toBeVisible();
  await copilot.getByRole('button', { name: 'Close chat', exact: true }).click();
  await fitAll(page);
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
