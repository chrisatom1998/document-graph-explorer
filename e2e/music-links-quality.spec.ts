import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const fixturePath = ENV?.MUSIC_LINKS_FIXTURE;

test('integrated fingerprint and Jamendo policy survives graph import, corrections, and reload', async ({ page }) => {
  page.setDefaultTimeout(60_000);
  const base = { kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: 0, status: 'ok' };
  const vector = (cosine: number, axis = 1, scale = 1) => Array.from({ length: 512 }, (_, i) =>
    i === 0 ? cosine * scale : i === axis ? Math.sqrt(1 - cosine ** 2) * scale : 0);
  const sound = (id: string, cosine: number, axis = 1, score = .9) => {
    // Synthetic saved evidence exercises the browser's real import projection; no inference or pair truth is implied.
    const evidenceId = 'jamendo:0:10:source:synthesizer';
    const recognition = { schemaVersion: 1, runId: `synthetic-${id}`, configurationHash: 'synthetic-policy-fixture',
      startedAt: '2026-10-06T00:00:00Z', status: 'complete', mode: 'full', calibration: 'unvalidated', jobs: [],
      evidence: [{ id: evidenceId, modelId: 'jamendo', start: 0, end: 10, dimension: 'source', labelId: 'synthesizer', score,
        validSeconds: 10, inputSeconds: 10, aggregation: 'window', padding: 'centered-mel-frames' }],
      observations: [{ id: 'source:synthesizer:0:10', dimension: 'source', labelId: 'synthesizer', familyId: 'synthesizer',
        start: 0, end: 10, evidenceIds: [evidenceId], status: 'possible' }] };
    return { ...base, id, title: `Sound ${id}`, audio: { version: 2, durationSeconds: 10, analyzedSeconds: 10, instruments: [], notes: [], recognition, embedding: vector(cosine, axis, 5) } };
  };
  const fixture = { version: 1, nodes: [sound('a', 1), sound('b', .99), sound('c', .75, 2, .45)], edges: [
    { id: 'manual', source: 'a', target: 'c', kind: 'reference', authored: true, weight: 1, evidence: ['Session notes'] },
    { id: 'stale', source: 'a', target: 'c', kind: 'similar', weight: .9, evidence: ['Stale import'] },
  ] };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const importGraph = async (graph: unknown) => {
    await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
    await page.locator('input[type="file"][accept*=".json"]').evaluate((element, contents) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([contents], 'synthetic-policy.json', { type: 'application/json' }));
      Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, JSON.stringify(graph));
    await expect(page.getByRole('button', { name: 'Search documents', exact: true })).toBeEnabled();
    const guide = page.getByRole('button', { name: 'Dismiss getting started' }); if (await guide.isVisible()) await guide.click();
  };
  const exportGraph = async () => {
    await page.getByRole('button', { name: 'Data options', exact: true }).click();
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export graph JSON', exact: true }).click();
    const stream = await (await promise).createReadStream(); let text = ''; for await (const chunk of stream!) text += chunk;
    return JSON.parse(text);
  };
  await importGraph(fixture);
  await page.getByRole('button', { name: 'Switch to 2D view', exact: true }).click();
  const initial = await exportGraph();
  expect(initial.edges.map((e: { kind: string }) => e.kind).sort()).toEqual(['instrument', 'reference', 'similar']);
  const similar = initial.edges.find((e: { kind: string }) => e.kind === 'similar');
  expect([similar.source, similar.target]).toEqual(['a', 'b']);
  expect(similar.evidence[0]).toContain('Model similarity is not a listening judgment');
  expect(initial.edges.find((e: { kind: string }) => e.kind === 'instrument').weight).toBe(.7);
  // A saved correction changes derived links through the real import/refresh path.
  for (const decision of ['rejected', 'uncertain']) {
    initial.nodes.find((n: { id: string }) => n.id === 'a').audio.soundReviews = [{ dimension: 'source', labelId: 'synthesizer', decision, scope: 'track', at: '2026-10-06T00:00:00Z', evidenceRunId: 'review' }];
    await page.reload(); await importGraph(initial);
    const corrected = await exportGraph();
    expect(corrected.edges.map((e: { kind: string }) => e.kind).sort()).toEqual(['reference', 'similar']);
    expect(corrected.edges.find((e: { id: string }) => e.id === 'manual')).toEqual(fixture.edges[0]);
    await page.reload(); await importGraph(corrected);
    const restored = await exportGraph();
    expect(restored.edges).toEqual(corrected.edges);
    expect(restored.nodes.find((n: { id: string }) => n.id === 'a').audio.soundReviews[0].decision).toBe(decision);
  }
  expect(errors).toEqual([]);
});

// This is an opt-in integration check for the licensed cached-feature fixture
// emitted by scripts/evaluate-music-links.mjs, never the user's saved graph.
test('licensed audio fixture keeps its derived edges and honest reasons through filters and reload', async ({ page }, testInfo) => {
  test.skip(!fixturePath, 'Set MUSIC_LINKS_FIXTURE to the evaluator browser fixture.');
  page.setDefaultTimeout(60_000);
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8'));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('knowledge-nebula-theme', 'dark'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const importGraph = async (contents: string) => {
    await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
    await page.locator('input[type="file"][accept*=".json"]').evaluate((element, contents) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([contents], 'licensed-audio-fixture.json', { type: 'application/json' }));
      Object.defineProperty(element, 'files', { configurable: true, value: transfer.files });
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, contents);
    await expect(page.getByRole('button', { name: 'Search documents', exact: true })).toBeEnabled();
    const guide = page.getByRole('button', { name: 'Dismiss getting started' }); if (await guide.isVisible()) await guide.click();
  };
  const exportGraph = async () => {
    await page.getByRole('button', { name: 'Data options', exact: true }).click();
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export graph JSON', exact: true }).click();
    const stream = await (await promise).createReadStream(); let text = ''; for await (const chunk of stream!) text += chunk;
    return JSON.parse(text);
  };
  await importGraph(JSON.stringify(fixture));
  await page.getByRole('button', { name: 'Switch to 2D view', exact: true }).click();
  await expect(page.getByRole('application', { name: /Interactive 2D/ })).toBeVisible();
  await page.getByRole('button', { name: 'Show graph filters', exact: true }).click();
  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  const fingerprintFilter = page.getByRole('button', { name: 'sounds alike', exact: true });
  await fingerprintFilter.click(); await expect(fingerprintFilter).toHaveAttribute('aria-pressed', 'true');
  await fingerprintFilter.click(); await page.getByRole('button', { name: 'Hide graph filters', exact: true }).click();
  const guitar = 'sc-a943c8b6ab615fcb';
  await page.getByRole('button', { name: 'Search documents', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(guitar) }).click();
  await expect(page.locator('.audio-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  const showAll = page.getByRole('button', { name: /Show all \d+ connections/ }); if (await showAll.isVisible()) await showAll.click();
  await expect(page.locator('.side-panel')).toContainText('guitar: model estimate / model estimate');
  await expect(page.locator('.side-panel')).toContainText('Model similarity is not a listening judgment');
  await expect(page.locator('.side-panel')).toContainText('not proof of exact duplicates');
  await page.locator('.connection-row').filter({ hasText: 'Nearby audio fingerprints' }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('licensed-pair-explanations.png') });
  const exported = await exportGraph();
  expect(exported.edges).toEqual(fixture.edges);
  expect(exported.edges.some((e: { kind: string }) => e.kind === 'tempo' || e.kind === 'key')).toBe(false);
  await page.reload(); await importGraph(JSON.stringify(exported));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'glass-dark');
  const restored = await exportGraph();
  expect(restored.edges).toEqual(exported.edges);
  expect(restored.nodes.map((n: { id: string }) => n.id)).toEqual(exported.nodes.map((n: { id: string }) => n.id));
  expect(errors).toEqual([]);
});
