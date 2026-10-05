// Cold and warm upload-to-result time for 1 s and 2 s clips in the real built app.
// Cold = fresh browser profile (no cached models, features or graph). Warm = a different clip of the same
// length uploaded right after, in the same page. Clips come from the calibration split, never the test split.
// Usage: [DIST=dir] node scripts/short-clip-timing.mjs <out.json> [repeats=3]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [out, repeatsArg = '3'] = process.argv.slice(2);
const AUDIO = '/Users/chrisjohnson/Documents/Media/dj-training-fingerprints/short-clips/bench-audio';
const manifest = JSON.parse(readFileSync('docs/evaluations/short-clips-2026-10-04/manifest.json', 'utf8'));
const meta = JSON.parse(readFileSync('docs/evaluations/short-clips-2026-10-04/item-meta.json', 'utf8'));
const cal = manifest.items.filter(i => i.split === 'calibration' && meta[i.id].dataset === 'nsynth');
const pick = secs => cal.filter(i => meta[i.id].durationSeconds === secs).map(i => i.id);
const PORT = Number(process.env.PORT ?? 4293);
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'ignore' });
process.on('exit', () => { try { server.kill(); } catch { /* gone */ } });
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Users/chrisjohnson/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });

async function session(ids) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('button', { name: 'Add files', exact: true }).waitFor();
  const times = [];
  for (const id of ids) {
    const picker = page.locator('body > input[type="file"][multiple]');
    if (!(await picker.count())) { page.once('filechooser', () => {}); await page.getByRole('button', { name: 'Add files', exact: true }).click({ timeout: 120_000 }); }
    const t0 = Date.now();
    await picker.setInputFiles(`${AUDIO}/${id}.wav`);
    for (;;) {
      await page.waitForTimeout(400);
      if (!(await page.getByRole('button', { name: 'Search documents' }).isEnabled().catch(() => false))) continue;
      // The Sounds panel reads this same graph state; a finished recognition run is what it displays.
      await page.getByRole('button', { name: 'Data options' }).click();
      const dl = page.waitForEvent('download', { timeout: 30_000 });
      await page.getByRole('button', { name: /Export graph JSON/ }).click();
      const graph = JSON.parse(readFileSync(await (await dl).path(), 'utf8'));
      const node = graph.nodes.find(n => (n.path ?? n.title) === `${id}.wav`);
      const a = node?.audio;
      if (a && a.stage !== 'preview' && ['complete', 'partial', 'failed'].includes(a.recognition?.status)) { times.push((Date.now() - t0) / 1000); break; }
      if (Date.now() - t0 > 600_000) { times.push(null); break; }
    }
  }
  await context.close();
  return times;
}
const result = { dist: process.env.DIST ?? 'dist', at: new Date().toISOString(), note: 'seconds from file hand-off to a finished analysis visible in the graph export; includes up to ~1 s polling overhead', runs: [] };
const ones = pick(1), twos = pick(2);
for (let r = 0; r < Number(repeatsArg); r++) {
  const [c1, w1] = await session([ones[2 * r], ones[2 * r + 1]]);
  const [c2, w2] = await session([twos[2 * r], twos[2 * r + 1]]);
  result.runs.push({ cold1s: c1, warm1s: w1, cold2s: c2, warm2s: w2 });
  console.log(JSON.stringify(result.runs.at(-1)));
}
const median = k => { const v = result.runs.map(r => r[k]).filter(x => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
result.median = Object.fromEntries(['cold1s', 'warm1s', 'cold2s', 'warm2s'].map(k => [k, median(k)]));
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.median));
await browser.close(); process.exit(0);
