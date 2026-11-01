import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile, copyFile, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { waitForGraphReady } from './resonance';

// Kept in step with MAX_INGEST_FILE_BYTES (src/config.ts) and TEXT_DISGUISED_AS_AUDIO (src/ingest/fileRouter.ts).
const MAX_INGEST_FILE_BYTES = 64 * 1024 * 1024;
const TEXT_DISGUISED_AS_AUDIO = 'not audio (file contents are text)';

const FLUTE = 'src/audio/sourceMatching/testfixtures/iowa-flute-first8s.wav';
const MARIMBA = 'src/audio/sourceMatching/testfixtures/iowa-marimba-C7.wav';

function tone(frequency: number, seconds = 1) {
  const count = 16000 * seconds;
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i * 2 * Math.PI * frequency / 16000)), 44 + i * 2);
  return wav;
}

/** First `seconds` of a 16-bit PCM WAV. The Iowa flute fixture is that format. */
function slicePcm(bytes: Buffer, seconds: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let channels = 0, rate = 0, bits = 0, dataAt = -1, dataSize = 0;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      dataAt = at + 8;
      dataSize = size;
      break;
    }
    at += 8 + size + (size & 1);
  }
  if (bits !== 16 || channels < 1 || dataAt < 0) throw new Error('Expected 16-bit PCM');
  const frame = channels * 2;
  const frames = Math.min(Math.floor(dataSize / frame), Math.floor(seconds * rate));
  const pcm = bytes.subarray(dataAt, dataAt + frames * frame);
  const out = Buffer.alloc(44 + pcm.length);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * frame, 28);
  out.writeUInt16LE(frame, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}

async function chooseFiles(page: Page, button: string | RegExp, files: string | string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles(files);
}

test('folder picker ingests a real folder and shows sound tags', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss(); });
  const folder = test.info().outputPath('clips');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'flute-phrase.wav'), slicePcm(await readFile(FLUTE), 2));
  await copyFile(MARIMBA, join(folder, 'marimba-hit.wav'));
  await writeFile(join(folder, 'kick-drum.wav'), tone(90, 1));
  await page.addInitScript(() => {
    localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'fast' }));
  });
  await page.goto('/');
  await chooseFiles(page, /^Add a folder/, folder);
  await expect(page.locator('.rs-count')).toContainText('3 clips', { timeout: 180_000 });
  await waitForGraphReady(page, 180_000);
  const openClip = async (name: RegExp) => {
    await page.getByRole('button', { name: 'Search documents' }).click();
    await page.locator('.search-result-row').filter({ hasText: name }).first().click();
  };
  for (const name of [/flute phrase/i, /marimba hit/i]) {
    await openClip(name);
    const sounds = page.getByRole('region', { name: 'Sound identification' });
    await expect(sounds.locator('.sound-tag:not(.sound-tag--name)').first()).toBeVisible({ timeout: 180_000 });
  }
  await openClip(/kick drum/i);
  await expect(page.getByRole('region', { name: 'Sound identification' }).locator('.sound-tag').first()).toBeVisible({ timeout: 180_000 });
  expect(errors).toEqual([]);
});

test('zip input uploads a pack archive through the sample assistant', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const zipPath = test.info().outputPath('pack.zip');
  const zip = new JSZip();
  zip.file('kick-drum.wav', tone(110, 1));
  await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));
  const zipSize = (await readFile(zipPath)).length;
  let uploaded = 0;
  await page.route('**/api/dj-reviewer/**', async route => {
    const url = route.request().url();
    if (url.includes('/archive')) {
      uploaded = route.request().postDataBuffer()?.length ?? 0;
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'a'.repeat(24) }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'complete', message: 'Complete', result: { added: 1, skipped: 0, failed: [] } }),
    });
  });
  const fixture = JSON.stringify({
    version: 1, generator: 'knowledge-nebula', createdAt: '2026-11-01T00:00:00.000Z', includeEmbeddings: false,
    nodes: [{ id: 'sound-0', title: 'Piano phrase', kind: 'document', fileType: 'audio', topics: [], entities: [], keywords: [], wordCount: 0, degree: 0, cluster: 0, status: 'ok', audio: { version: 2, analyzedSeconds: 2, durationSeconds: 2, instruments: [], notes: [], confirmedDjTags: { source: ['piano'], production: [], character: [] } } }],
    edges: [],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a graph', exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').evaluate((element, contents) => {
    const files = new DataTransfer();
    files.items.add(new File([contents], 'library.json', { type: 'application/json' }));
    Object.defineProperty(element, 'files', { configurable: true, value: files.files });
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixture);
  await expect(page.getByRole('button', { name: 'Search documents' })).toBeEnabled();
  const guide = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await guide.isVisible()) await guide.click();
  await page.getByRole('button', { name: 'Sample assistant', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Find your next sound.' });
  await dialog.getByText('Tools', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Find free packs' }).click();
  const archive = dialog.getByLabel('Pack archive');
  await expect(archive).toHaveAttribute('accept', /\.zip/);
  const submit = dialog.getByRole('button', { name: 'Import archive to reviewer' });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Pack name').fill('E2E pack');
  await dialog.getByLabel('Publisher page').fill('https://example.org/pack');
  await dialog.getByLabel('License evidence page').fill('https://example.org/license');
  await archive.setInputFiles(zipPath);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog.getByText('1 sounds added')).toBeVisible();
  expect(uploaded).toBe(zipSize);
  expect(errors).toEqual([]);
});

test('an oversized file is rejected against the ingest cap', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const path = test.info().outputPath('oversized-note.txt');
  const handle = await open(path, 'w');
  await handle.truncate(MAX_INGEST_FILE_BYTES + 1);
  await handle.close();
  await page.goto('/');
  await chooseFiles(page, 'Add files', path);
  await expect(page.locator('.ignored-tray__row-reason')).toContainText('too large (over 64 MB)');
  await expect(page.getByRole('button', { name: 'Add files', exact: true })).toBeVisible();
  await expect(page.locator('.rs-count')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a .wav whose bytes are text is rejected by content sniffing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const path = test.info().outputPath('mislabeled.wav');
  await writeFile(path, 'this is plain text, not a waveform\n');
  await page.goto('/');
  await chooseFiles(page, 'Add files', path);
  await expect(page.locator('.ignored-tray__row')).toContainText('mislabeled.wav');
  await expect(page.locator('.ignored-tray__row-reason')).toHaveText(TEXT_DISGUISED_AS_AUDIO);
  await expect(page.locator('.rs-count')).toHaveCount(0);
  expect(errors).toEqual([]);
});
