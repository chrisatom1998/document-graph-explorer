// Real-upload check of the Sounds panel: uploads audio files into the BUILT app (vite preview, fresh
// headless profile), waits for analysis, then reads each file's Sounds tags straight from the page
// (label, kind, possible/likely tier, hover text) and the app's own graph export.
// Usage: node scripts/ui-upload-check.mjs <out-dir> <audio files...>   (run `npm run build` first)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [outDir, ...files] = process.argv.slice(2);
if (!outDir || !files.length) throw new Error('Usage: node scripts/ui-upload-check.mjs <out-dir> <audio files...>');
mkdirSync(outDir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4297), LIMIT_MIN = Number(process.env.LIMIT_MIN ?? 25);
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Users/chrisjohnson/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce', acceptDownloads: true })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
await page.goto(`http://127.0.0.1:${PORT}/`);

async function exportGraph() {
  await page.getByRole('button', { name: 'Data options' }).click();
  const download = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: /Export graph JSON/ }).click();
  const file = join(outDir, 'graph-export.json'); await (await download).saveAs(file);
  await page.keyboard.press('Escape').catch(() => {});
  return JSON.parse(readFileSync(file, 'utf8'));
}
const finished = a => a && a.stage !== 'preview' && a.recognition && ['complete', 'partial', 'failed', 'cancelled'].includes(a.recognition.status);
const chooser = page.waitForEvent('filechooser', { timeout: 240_000 });
await page.getByRole('button', { name: 'Add files', exact: true }).click({ timeout: 240_000 });
const t0 = Date.now();
await (await chooser).setFiles(files);
await page.getByRole('button', { name: 'Switch to 2D view' }).click({ timeout: 120_000 }).catch(() => {});
let graph, notices = new Set();
for (;;) {
  await page.waitForTimeout(10_000);
  for (const t of await page.locator('[role=alert],[role=status]').allInnerTexts().catch(() => [])) if (/could not|failed|unsupported|silent/i.test(t)) notices.add(t.trim().slice(0, 200));
  if (!(await page.getByRole('button', { name: 'Search documents' }).isEnabled().catch(() => false))) continue;
  graph = await exportGraph().catch(() => undefined); if (!graph) continue;
  const audio = graph.nodes.filter(n => n.audio);
  const done = audio.filter(n => finished(n.audio)).length;
  process.stdout.write(`\r${done}/${audio.length} analysed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (audio.length && done === audio.length) break;
  if (Date.now() - t0 > LIMIT_MIN * 60_000) { console.log('\ntime limit'); break; }
}
const results = [];
for (const f of files) {
  const name = basename(f);
  const node = graph?.nodes.find(n => (n.path ?? n.title) === name || n.title?.toLowerCase().replace(/\s+/g, '') === name.replace(/\.\w+$/, '').replace(/[-_]/g, '').toLowerCase());
  const row = { file: name, inGraph: !!node, durationSeconds: node?.audio?.durationSeconds, status: node?.audio?.recognition?.status,
    models: node?.audio?.recognition?.runs?.map?.(r => [r.modelId, r.status]) };
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: 'Search documents' }).click();
    await page.keyboard.type(name.replace(/\.\w+$/, '').slice(3, 12));
    await page.getByRole('option').first().click({ timeout: 30_000 });
    const panel = page.locator('section[aria-label="Sound identification"]');
    await panel.waitFor({ timeout: 60_000 });
    row.policy = await panel.getAttribute('data-display-policy');
    row.tags = await panel.locator('li.sound-tag').evaluateAll(els => els.map(e => ({ label: e.querySelector('span:not(.sound-tag__mark):not(.sound-tag__note):not(.sr-only)')?.textContent ?? '',
      kind: [...e.classList].filter(c => c.startsWith('sound-tag--')).map(c => c.slice(11)).join('+'), tier: e.dataset.tier ?? null, note: e.querySelector('.sound-tag__note')?.textContent ?? null, hover: e.title })));
    row.empty = await panel.locator('.sound-tags__empty').count() > 0;
    await page.screenshot({ path: join(outDir, `${name}.png`) });
  } catch (e) { row.error = String(e.message).slice(0, 160); }
  results.push(row); console.log('\n' + JSON.stringify({ file: row.file, status: row.status, tags: row.tags?.map(t => `${t.label}${t.note ? ` (${t.note})` : ''}`), error: row.error }));
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, notices: [...notices], pageErrors: errors.slice(0, 30), results }, null, 1));
await browser.close(); process.exit(0);
