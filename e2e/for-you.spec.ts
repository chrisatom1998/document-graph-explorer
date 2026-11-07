/**
 * Browser tests for the Resonance "For you" view.
 *
 * They run against a BUILT app (scripts/build-e2e.mjs) served by `vite preview` on
 * 127.0.0.1, with the test-only no-inference boundary ON (src/e2e/noInference.ts):
 * audio analysis, model preloading and text-embedding models never start, and text
 * embeddings are deterministic E2E_STUB vectors. Real here: the file inputs, parsing,
 * hashing, IndexedDB persistence, graph nodes and edges, WebAudio decode, playback of
 * the saved original, search, library, export and layout. NOT covered: real analysis
 * (tempo/key/tags from models) and real embeddings.
 *
 * Guards, installed on the browser CONTEXT so page, worker and iframe traffic all pass
 * through them (Chrome is also launched with a host-resolver rule for non-127.0.0.1):
 *  - any non-local request is aborted and fails the test;
 *  - any model weight / model folder / inference runtime chunk request is aborted and fails the test;
 *  - the boundary's own violation counter must stay empty.
 * Audio is a tiny WAV generated here in memory (or a throwaway temp dir) and given to the
 * app's real <input type="file">; it never leaves 127.0.0.1.
 */
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const SHOTS = ENV?.FOR_YOU_SHOTS;
// Weights anywhere, the bundled embedding model folder, and the chunks/workers that run inference.
const MODEL_URL = /\.(onnx|safetensors|ort|gguf|bin)(\?|$)|\/models\/|musicAnalysis\.worker|passt|tagger|transformers|onnxruntime|ort-wasm/i;

interface Guard { remote: string[]; modelRequests: string[]; allLocal: number }

const test = base.extend<{ guard: Guard }>({
  guard: [async ({ context }, use) => {
    const g: Guard = { remote: [], modelRequests: [], allLocal: 0 };
    await installGuard(context, g);
    await use(g);
  }, { auto: true }],
});

async function installGuard(context: BrowserContext, g: Guard): Promise<void> {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { g.remote.push(url.href); return route.abort('blockedbyclient'); }
    g.allLocal += 1;
    if (MODEL_URL.test(url.pathname)) { g.modelRequests.push(url.pathname); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  await context.routeWebSocket(/.*/, ws => { g.remote.push(ws.url()); void ws.close(); });
}

async function assertSafe(page: Page, g: Guard): Promise<void> {
  expect(g.remote, 'no request (page, worker or socket) may leave localhost').toEqual([]);
  expect(g.modelRequests, 'zero model or inference-runtime requests').toEqual([]);
  const counters = await page.evaluate(() => (globalThis as { __DGE_E2E__?: { violations: string[] } }).__DGE_E2E__?.violations ?? []);
  expect(counters, 'no inference entry point was reached').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.dataset.e2eNoInference)).toBe('1');
}

/** A 1.5 s, 16 kHz mono 440 Hz sine as a PCM WAV. Generated here; no recorded audio. */
function syntheticWav(hz = 440): Buffer {
  const rate = 16000, count = rate * 1.5;
  const buf = Buffer.alloc(44 + count * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buf.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * hz) / rate) * 8000), 44 + i * 2);
  return buf;
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function addFileThroughPicker(page: Page, name = 'Synthetic tone.wav'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files', exact: true }).first().click();
  await (await chooser).setFiles({ name, mimeType: 'audio/wav', buffer: syntheticWav() });
}

/** Scroll For you to the top, and check that nothing floating covers the headline, the crate panel or the transport. */
async function assertClearTop(page: Page): Promise<void> {
  await page.evaluate(() => { document.querySelector('.fy')?.scrollTo(0, 0); window.scrollTo(0, 0); });
  const digest = page.getByRole('status', { name: 'What we found' });
  await digest.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
  const boxes = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const selector of ['.fy-map__title', '.fy-mix', '.fy-transport']) {
    const target = await boxes(selector);
    for (const floating of ['.insights-digest', '.first-run-guide']) {
      if (await page.locator(floating).first().isVisible().catch(() => false)) {
        expect(overlaps(await boxes(floating), target), `${floating} must not cover ${selector}`).toBe(false);
      }
    }
  }
  // The hero starts at the top of the page, below the bar, not scrolled under it.
  expect((await boxes('.fy-map')).y).toBeGreaterThanOrEqual((await boxes('.rs-top')).y + (await boxes('.rs-top')).height - 2);
}

const card = (page: Page, title: string) => page.locator('.fy-card__title', { hasText: new RegExp(title, 'i') });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Views' });
const tab = (page: Page, name: string) => nav(page).getByRole('button', { name, exact: true });
const transport = (page: Page) => page.getByRole('contentinfo', { name: 'Audio player' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('knowledge-nebula-first-graph-guide-v5', 'dismissed'); } catch { /* ignore */ } });
});

test('guard self-test: remote traffic from the page, a worker and a navigation is refused', async ({ page, guard }) => {
  await page.goto('/');
  const pageResult = await page.evaluate(() => fetch('https://example.invalid/page-probe').then(() => 'reached', () => 'blocked'));
  const workerResult = await page.evaluate(() => new Promise<string>(resolve => {
    const worker = new Worker(URL.createObjectURL(new Blob(["fetch('https://example.invalid/worker-probe').then(() => postMessage('reached'), () => postMessage('blocked'))"])));
    worker.onmessage = e => resolve(String(e.data));
  }));
  // The app's own CSP and Chrome's host-resolver rule already stop these; both layers must hold.
  expect(pageResult).toBe('blocked');
  expect(workerResult).toBe('blocked');
  await assertSafe(page, guard);
  // CSP does not apply to navigation, so this is the probe that proves the context-level route refuses remote hosts.
  await page.goto('https://example.invalid/route-probe').catch(() => undefined);
  expect(guard.remote.some(u => u.includes('route-probe')), 'the context route saw and aborted the remote navigation').toBe(true);
  expect(guard.remote).toHaveLength(1);
});

test('empty state keeps the layout and claims nothing', async ({ page, guard }) => {
  await page.goto('/');
  await expect(nav(page).getByRole('button')).toHaveText(['For you', 'Graph', 'Library', 'Export']);
  await expect(tab(page, 'For you')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Resonance', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your sound map starts here');
  await expect(page.getByRole('heading', { name: 'Mixes in key' })).toBeVisible();
  await expect(page.locator('.fy-mix__title')).toHaveText('No key crate yet');
  await expect(page.getByRole('button', { name: 'Add a folder' }).first()).toBeVisible();
  await expect(transport(page)).toContainText('Nothing playing');
  const body = await page.locator('.fy').innerText();
  expect(body).not.toMatch(/\d+ (clips?|neighbourhoods?|BPM)/i);
  await expect(page.locator('.fy-tag, .fy-chip, .fy-card__title')).toHaveCount(0);
  await expect(tab(page, 'Library')).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Search documents/ })).toHaveAttribute('aria-disabled', 'true');
  await shot(page, 'desktop-empty');
  await assertSafe(page, guard);
});

test('tabs work from the keyboard and focus is visible', async ({ page, guard }) => {
  await page.goto('/');
  await tab(page, 'For you').focus();
  expect(await tab(page, 'For you').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(tab(page, 'Graph')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tab(page, 'Graph')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.fy')).toHaveCount(0);
  await page.keyboard.press('Tab'); // Library is disabled while empty
  await expect(tab(page, 'Export')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'Export and import' })).toBeVisible();
  await tab(page, 'For you').click();
  await expect(page.locator('.fy')).toBeVisible();
  await assertSafe(page, guard);
});

test('a real upload: analysis stays off, the clip is a node, and search, playback, graph, library, export and folders work', async ({ page, guard }) => {
  test.setTimeout(240_000);
  await page.goto('/');

  // Real file input through the empty-state button.
  await addFileThroughPicker(page);
  await expect(card(page, 'Synthetic tone')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^1 clip/);
  // One real clip stays a small card (about 150-180px), not a stretched banner, and its name sits below the art on screen.
  const cardBox = (await page.locator('.fy-card').first().boundingBox())!;
  expect(cardBox.width).toBeGreaterThanOrEqual(140);
  expect(cardBox.width).toBeLessThanOrEqual(190);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(900 - 84);
  await expect(card(page, 'Synthetic tone')).toBeInViewport();
  await assertClearTop(page);
  await shot(page, 'desktop-with-clip');

  // Disabled analysis really did not run, and nothing was made up in its place.
  const counters = await page.evaluate(() => (globalThis as { __DGE_E2E__?: { skippedAnalysis: number } }).__DGE_E2E__ ?? null);
  expect(counters?.skippedAnalysis, 'the coordinator reached analysis and skipped it').toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter(k => k === 'dge-audio-analysis-used')))).toBe('[]');
  await expect(page.locator('.fy-card .fy-chip')).toHaveText(['No tempo or key yet']);
  await expect(page.locator('.fy-tag')).toHaveCount(0);
  await expect(page.locator('.fy-mix__title')).toHaveText('No keys found yet');

  // Search by button and by Ctrl+K.
  await page.getByRole('button', { name: /^Search documents/ }).click();
  await page.getByPlaceholder(/search/i).first().fill('Synthetic');
  await expect(page.getByRole('option', { name: /Synthetic tone/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();
  await page.getByPlaceholder(/search/i).first().fill('Synthetic');
  // Choosing a result must leave For you and show the clip: the Graph view with its details open.
  await page.getByRole('option', { name: /Synthetic tone/i }).click();
  await expect(tab(page, 'Graph')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.fy')).toHaveCount(0);
  await expect(page.getByRole('region', { name: /^Synthetic tone$/i })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  await tab(page, 'For you').click();

  // Playback from the card into the fixed transport: a real decode of the saved original.
  await page.getByRole('button', { name: /^Play Synthetic tone/i }).first().click();
  const audio = transport(page).locator('audio');
  await expect(audio).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime > 0 || el.ended)).toBe(true);
  expect(await audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(1.4);
  await expect(transport(page)).toContainText(/synthetic tone/i);
  await transport(page).getByRole('button', { name: 'Loop' }).click();
  await expect(transport(page).getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
  const seek = transport(page).getByRole('slider', { name: /Seek in Synthetic tone/i });
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  const box = await transport(page).boundingBox();
  expect(box!.y + box!.height).toBeCloseTo(900, 0);
  await assertClearTop(page);
  await shot(page, 'desktop-playing');

  // Library, then the graph with the inspector's own player.
  await tab(page, 'Library').click();
  await page.getByRole('listbox', { name: 'Graph nodes' }).getByRole('option', { name: /Synthetic tone/i }).click();
  await tab(page, 'Graph').click();
  await expect(page.locator('canvas').first()).toBeVisible();
  // Opening a clip from the library shows full details, whose own player (Play sample) is the second player.
  const inspectorPlay = page.getByRole('button', { name: 'Play sample' });
  await expect(inspectorPlay).toBeEnabled({ timeout: 30_000 });
  // The busier Graph bar must not run tabs, search and actions into each other.
  const barBoxes = await Promise.all([tab(page, 'Export'), page.getByRole('button', { name: /^Search documents/ }), page.getByRole('button', { name: 'Add a folder' }).first()].map(l => l.boundingBox()));
  for (let i = 0; i < barBoxes.length - 1; i++) expect(barBoxes[i]!.x + barBoxes[i]!.width, `bar item ${i} overlaps the next`).toBeLessThanOrEqual(barBoxes[i + 1]!.x + 1);
  await expect(tab(page, 'For you')).toHaveCSS('white-space', 'nowrap');
  await shot(page, 'desktop-graph');

  // Reciprocal single player, both start orders. Order 1: the inspector starts while the transport plays.
  const transportAudio = transport(page).locator('audio');
  const inspectorAudio = page.locator('aside audio').first();
  await transportAudio.evaluate((el: HTMLAudioElement) => { el.loop = true; return el.play(); });
  expect(await transportAudio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false);
  await inspectorPlay.click();
  await expect.poll(() => inspectorAudio.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true);
  await expect.poll(() => transportAudio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
  // Order 2: the transport starts while the inspector plays.
  await transport(page).getByRole('button', { name: /^Play Synthetic tone/i }).click();
  await expect.poll(() => transportAudio.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true);
  await expect.poll(() => inspectorAudio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);

  // Export: the button must become enabled, the download must happen, and the file must be a real graph.
  await tab(page, 'Export').click();
  const exportJson = page.getByRole('button', { name: /Export graph JSON/ });
  await expect(exportJson).toBeEnabled({ timeout: 90_000 });
  const download = page.waitForEvent('download');
  await exportJson.click();
  const exported = JSON.parse(readFileSync((await (await download).path()), 'utf8'));
  expect(exported).toMatchObject({ version: 1, generator: 'knowledge-nebula' });
  expect(Array.isArray(exported.edges)).toBe(true);
  expect(exported.nodes.filter((n: { kind: string }) => n.kind === 'document')).toHaveLength(1);
  expect(exported.nodes.find((n: { title: string }) => /^synthetic tone/i.test(n.title))).toMatchObject({ fileType: 'audio', kind: 'document' });
  expect(exported.nodes.every((n: { audio?: unknown }) => !n.audio), 'no analysis was fabricated').toBe(true);

  // Add a folder: the top-bar pill opens the folder input and a temp directory ingests through it.
  const dir = mkdtempSync(join(tmpdir(), 'resonance-folder-'));
  try {
    writeFileSync(join(dir, 'Folder clip.wav'), syntheticWav());
    await tab(page, 'For you').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add a folder' }).first().click();
    await (await chooser).setFiles(dir);
    await expect(card(page, 'Folder clip')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^2 clips/);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const after = await page.evaluate(() => (globalThis as { __DGE_E2E__?: { skippedAnalysis: number } }).__DGE_E2E__?.skippedAnalysis ?? 0);
  expect(after).toBeGreaterThanOrEqual(2);
  await assertSafe(page, guard);
});

test('mobile layout: no sideways scroll, transport pinned, upload works', async ({ page, guard }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await expect(tab(page, 'For you')).toBeVisible();
  await expect(tab(page, 'Export')).toBeVisible();
  // The top-bar folder button is icon-only on a phone and must still carry its name.
  const barFolder = page.getByRole('banner').getByRole('button', { name: 'Add a folder' });
  await expect(barFolder).toBeVisible();
  await expect(barFolder).toHaveAccessibleName('Add a folder');
  await expect(barFolder.locator('span')).toBeHidden();
  const box = await transport(page).boundingBox();
  expect(box!.y + box!.height).toBeCloseTo(844, 0);
  for (const name of ['For you', 'Graph', 'Export']) expect((await tab(page, name).boundingBox())!.height).toBeGreaterThanOrEqual(36);
  await shot(page, 'mobile-empty');
  await addFileThroughPicker(page);
  await expect(card(page, 'Synthetic tone')).toBeVisible({ timeout: 90_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await assertClearTop(page);
  await shot(page, 'mobile-with-clip');
  await card(page, 'Synthetic tone').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /^Play Synthetic tone/i }).first().click();
  await expect(transport(page).locator('audio')).toHaveAttribute('src', /^blob:/);
  await assertClearTop(page);
  await shot(page, 'mobile-playing');
  await assertSafe(page, guard);
});

test('desktop grid: several real clips make rows of six equal small cards', async ({ page, guard }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add files', exact: true }).first().click();
  // Seven distinct generated tones, so each is its own clip.
  await (await chooser).setFiles([0, 1, 2, 3, 4, 5, 6].map(i => ({ name: `Tone ${i + 1}.wav`, mimeType: 'audio/wav', buffer: syntheticWav(220 + i * 55) })));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^7 clips/, { timeout: 120_000 });
  await expect(page.locator('.fy-card')).toHaveCount(6); // the row shows six; "Show all" opens the rest
  const boxes = await page.locator('.fy-card').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; }));
  expect(new Set(boxes.map(b => Math.round(b.y))).size, 'one row').toBe(1);
  expect(new Set(boxes.map(b => Math.round(b.w))).size, 'equal widths').toBe(1);
  expect(boxes[0].w).toBeLessThanOrEqual(190);
  await assertClearTop(page);
  await shot(page, 'desktop-seven-clips');
  await assertSafe(page, guard);
});

test('reload keeps the clip, and the view the person chose', async ({ page, guard }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await addFileThroughPicker(page);
  await expect(card(page, 'Synthetic tone')).toBeVisible({ timeout: 90_000 });
  await page.reload();
  // A restored library opens on For you again with the clip still there (IndexedDB session restore).
  await expect(tab(page, 'For you')).toHaveAttribute('aria-current', 'page');
  await expect(card(page, 'Synthetic tone')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^1 clip/);
  await tab(page, 'Graph').click();
  await page.reload();
  await expect(tab(page, 'Graph')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('canvas').first()).toBeVisible();
  await assertSafe(page, guard);
});
