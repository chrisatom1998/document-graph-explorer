// Upload benchmark clips into the real built DGE app and save the graph export DGE itself produces.
// Usage: node scripts/short-clip-upload-eval.mjs <out-dir> [split=test] [batch=60] [limit]
// Requires `npm run build`. Starts its own `vite preview`; never touches the dev server or saved user data
// (each run uses a fresh browser profile). Clip names are opaque ids, so no filename hint exists.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, split = 'test', batchArg = '60', limitArg] = process.argv.slice(2);
if (!outDir) throw new Error('Usage: node scripts/short-clip-upload-eval.mjs <out-dir> [split] [batch] [limit]');
const AUDIO = process.env.AUDIO_DIR ?? '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips/bench-audio';
const manifest = JSON.parse(readFileSync(process.env.MANIFEST ?? 'docs/evaluations/short-clips-2026-10-04/manifest.json', 'utf8'));
let ids = manifest.items.filter(i => i.split === split).map(i => i.id);
if (limitArg) ids = ids.slice(0, Number(limitArg));
mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4291);
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 500)); } }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Users/chrisjohnson/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
await page.goto(`http://127.0.0.1:${PORT}/`);

async function exportGraph() {
  await page.getByRole('button', { name: 'Data options' }).click();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: /Export graph JSON/ }).click();
  const file = join(outDir, 'graph-export.json');
  await (await download).saveAs(file);
  return JSON.parse(readFileSync(file, 'utf8'));
}
const finished = a => a && a.stage !== 'preview' && a.recognition && ['complete', 'partial', 'failed', 'cancelled'].includes(a.recognition.status);
const timings = [];
for (let start = 0; start < ids.length; start += Number(batchArg)) {
  const batch = ids.slice(start, start + Number(batchArg));
  const t0 = Date.now();
  // DGE's own hidden picker input (created by the first "Add files" press) receives the files.
  const picker = page.locator('body > input[type="file"][multiple]');
  if (!(await picker.count())) {
    page.once('filechooser', () => {});
    await page.getByRole('button', { name: 'Add files', exact: true }).click({ timeout: 180_000 });
  }
  await picker.setInputFiles(batch.map(id => join(AUDIO, `${id}.wav`)));
  // 2D view: same analysis, far less software rendering competing with the models.
  if (start === 0) await page.getByRole('button', { name: 'Switch to 2D view' }).click({ timeout: 120_000 }).catch(() => {});
  let done = 0;
  for (;;) {
    await page.waitForTimeout(5000);
    if (!(await page.getByRole('button', { name: 'Search documents' }).isEnabled().catch(() => false))) {
      if (process.env.DEBUG) { console.log('\nsearch disabled'); await page.screenshot({ path: join(outDir, 'debug.png') }); }
      continue;
    }
    const graph = await exportGraph().catch(e => { if (process.env.DEBUG) console.log('\nexport failed', e.message); });
    if (!graph) continue;
    const want = new Set(batch.map(id => `${id}.wav`));
    const nodes = graph.nodes.filter(n => want.has(n.path ?? n.title));
    done = nodes.filter(n => finished(n.audio)).length;
    process.stdout.write(`\r${start + done}/${ids.length} analysed`);
    if (process.env.DEBUG) console.log('', nodes.length, nodes.map(n => [n.audio?.stage, n.audio?.recognition?.status]));
    if (nodes.length === batch.length && done === batch.length) break;
    if (Date.now() - t0 > 30 * 60_000) { console.log('\nbatch timed out'); break; }
  }
  timings.push({ clips: batch.length, seconds: (Date.now() - t0) / 1000 });
}
await exportGraph();
// Read the Sounds panel itself for a sample of clips, to prove the export-based scoring matches the screen.
const domCheck = [];
for (const id of ids.slice(0, Number(process.env.DOM_CHECK ?? 0))) {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: 'Search documents' }).click();
    await page.keyboard.type(id.slice(3, 11));
    await page.getByRole('option').filter({ hasText: new RegExp(id.slice(3, 11), 'i') }).first().click({ timeout: 60_000 });
    const panel = page.locator('section[aria-label="Sound identification"]');
    await panel.waitFor({ timeout: 120_000 });
    const tags = await panel.locator('li.sound-tag').evaluateAll(els => els.map(e => ({ label: e.querySelector('span:not(.sound-tag__mark):not(.sound-tag__note):not(.sr-only)')?.textContent ?? '', kind: [...e.classList].find(c => c.startsWith('sound-tag--'))?.slice(11) })));
    domCheck.push({ id, tags });
  } catch (e) { domCheck.push({ id, error: String(e.message).slice(0, 120) }); }
}
if (domCheck.length) writeFileSync(join(outDir, 'dom-check.json'), JSON.stringify(domCheck, null, 1));
writeFileSync(join(outDir, 'run.json'), JSON.stringify({ split, clips: ids.length, timings, pageErrors: errors.slice(0, 50), at: new Date().toISOString() }, null, 1));
console.log(`\nSaved ${join(outDir, 'graph-export.json')}`);
await browser.close(); stop(); process.exit(0);
