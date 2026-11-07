#!/usr/bin/env node
// Captures the main screens for the shipped UI ("baseline") and each ?design=
// exploration with the generated audio demo: welcome, loading, home, a picked
// sound with its tags, the 3D view, full details and search, at a desktop and
// a phone width. Usage: start `npx vite preview --port 4173`, then
//   node scripts/design-screenshots.mjs [baseline a b c] [--out dir]
// CHROME_PATH points at a local Chrome when Playwright's bundled browser is absent.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : 'design-screenshots';
const designs = args.filter((arg, i) => !arg.startsWith('--') && (outIndex < 0 || i !== outIndex + 1));
const targets = designs.length ? designs : ['baseline', 'a', 'b', 'c'];
const base = process.env.BASE_URL ?? 'http://localhost:4173';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PICK = 'Pad Loop Am 100';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function shot(page, dir, name, wait = 900) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(dir, `${name}.png`) });
  console.log(`  ${dir}/${name}.png`);
}

async function dismissTour(page) {
  const tour = page.getByRole('button', { name: 'Dismiss getting started' });
  if (await tour.isVisible().catch(() => false)) await tour.click();
}

async function setDims(page, dims) {
  const toggle = page.getByRole('button', { name: dims === 3 ? 'Switch to 3D view' : 'Switch to 2D view' });
  const visible = toggle.locator('visible=true').first();
  if (await visible.count()) await visible.click();
  await page.waitForTimeout(6000);
  await page.keyboard.press('Home');
}

async function pick(page, design) {
  if (design === 'baseline') {
    await dismissTour(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('option', { name: new RegExp(PICK) }).click();
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
  } else {
    await page.getByRole('button', { name: new RegExp(PICK) }).locator('visible=true').first().click();
  }
  await page.waitForTimeout(2500);
  // Picking from a shelf scrolls the feed; start each shot from the top with the whole map in view.
  await page.evaluate(() => document.querySelectorAll('.mx-shell main').forEach(main => main.scrollTo(0, 0)));
  await page.keyboard.press('Home');
}

async function openDetails(page, design) {
  if (design === 'baseline') {
    const toggle = page.locator('.rs-inspector__details');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  } else {
    await page.getByRole('button', { name: 'Full details', exact: true }).locator('visible=true').first().click();
  }
  await page.locator('.side-panel').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
}

async function closeDetails(page, design) {
  if (design === 'baseline') {
    const toggle = page.locator('.rs-inspector__details');
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  } else if (design === 'c') {
    await page.getByRole('button', { name: 'Close details' }).click();
  } else {
    await page.getByRole('button', { name: /Hide (full )?details/ }).locator('visible=true').first().click();
  }
  await page.waitForTimeout(800);
}

for (const design of targets) {
  const dir = join(outDir, design);
  mkdirSync(dir, { recursive: true });
  console.log(`design ${design}`);
  const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: 'reduce' });
  // A fresh profile opens in 2D; the 3D shots switch explicitly.
  const page = await context.newPage();
  page.on('pageerror', error => console.log(`  pageerror: ${error.message}`));
  page.setDefaultTimeout(60_000);
  await page.goto(design === 'baseline' ? `${base}/` : `${base}/?design=${design}`);
  const start = page.getByRole('button', { name: /Load audio demo|Play the sample pack|Sample pack mix/ }).first();
  await start.waitFor();
  await shot(page, dir, 'desktop-1-welcome', 1500);
  const hidePicker = page.getByRole('button', { name: 'Hide design picker' });
  if (await hidePicker.count()) await hidePicker.click();
  // The picker is tooling, not part of any design: keep it out of the remaining shots.
  await page.addStyleTag({ content: '.design-switcher { display: none !important; }' });
  await page.setViewportSize(PHONE);
  await shot(page, dir, 'mobile-1-welcome');
  await page.setViewportSize(DESKTOP);

  await start.click();
  await page.locator('.progress-strip').waitFor({ timeout: 120_000 });
  await shot(page, dir, 'desktop-2-loading', 3500);

  await page.waitForFunction(() => /\d+ nodes · \d+ links/.test(document.querySelector('.rs-top__status')?.textContent ?? ''), null, { timeout: 900_000 });
  await page.waitForTimeout(4000);
  await dismissTour(page);
  await page.keyboard.press('Home');
  await shot(page, dir, 'desktop-3-home', 3000);

  await pick(page, design);
  await shot(page, dir, 'desktop-4-selected-tags', 2000);

  // For You keeps its map in a feed card; its 3D shot uses the expanded Sound Map.
  if (design === 'c') await page.getByRole('button', { name: 'Expand' }).click();
  await setDims(page, 3);
  await shot(page, dir, 'desktop-5-3d-view', 3000);
  await setDims(page, 2);
  if (design === 'c') await page.getByRole('button', { name: 'Close map' }).click();

  await openDetails(page, design);
  await shot(page, dir, 'desktop-6-details');
  await closeDetails(page, design);

  if (design === 'c') {
    await page.getByRole('button', { name: 'Expand' }).click();
    await page.waitForTimeout(1500);
    await page.keyboard.press('Home');
    await shot(page, dir, 'desktop-8-sound-map-expanded', 3000);
    await page.getByRole('button', { name: 'Close map' }).click();
  }

  await page.getByRole('button', { name: /^(Search|Search documents|Search sounds)$/ }).locator('visible=true').first().click();
  await page.locator('.search-overlay input').first().fill('bass');
  await shot(page, dir, 'desktop-7-search', 2500);
  await page.keyboard.press('Escape');

  await page.setViewportSize(PHONE);
  await page.waitForTimeout(1500);
  await dismissTour(page);
  await shot(page, dir, 'mobile-2-selected-tags', 1500);
  await page.evaluate(() => (document.querySelector('.mx-map') ?? document.querySelector('.rs-stage'))?.scrollIntoView({ block: 'start' }));
  await page.keyboard.press('Home');
  await shot(page, dir, 'mobile-3-map', 3000);
  await setDims(page, 3);
  await shot(page, dir, 'mobile-4-3d-view', 3000);
  await setDims(page, 2);
  await context.close();
}

await browser.close();
