// Run with vite-node. Uses the unchanged production UI and an isolated browser profile.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { installObserver, importBatch, savedGraph } from '../benchmarks/browser.mjs';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';
import { digest, loadManifest } from './core.mjs';

const [file, output] = process.argv.slice(2);
if (!file || !output) throw new Error('Usage: vite-node scripts/research/run-dge.mjs manifest.json new-output-directory');
const manifest = loadManifest(file);
if (existsSync(output)) throw new Error('Refusing to overwrite results');
if (!existsSync('dist/index.html')) throw new Error('Run npm run build first');
mkdirSync(output, { recursive: true });
const report = { version: 1, at: new Date().toISOString(), model: 'dge-production',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  manifestSha256: digest(readFileSync(file)), platform: process.platform, cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, node: process.version, rows: [],
  boundary: 'File picker through saved terminal result, including polling/stability waits; sequential clips in a fresh browser context. First clip cold, others warm. Heap is page-only.',
};
const port = process.env.DGE_RESEARCH_PORT ?? '4297';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let ready = false, serverLog = '';
for (const stream of [server.stdout, server.stderr]) stream.on('data', b => { serverLog += b; ready ||= serverLog.includes('127.0.0.1'); });
let browser;
try {
  for (let n = 0; n < 100 && !ready; n++) await new Promise(r => setTimeout(r, 100));
  if (!ready) throw new Error(`Preview did not start: ${serverLog}`);
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  report.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('crash', () => { report.aborted = 'Browser page crashed'; });
  await page.addInitScript(installObserver);
  await page.addInitScript(() => globalThis.localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Add files', exact: true }).waitFor();
  report.hardware = await page.evaluate(() => ({ cores: globalThis.navigator.hardwareConcurrency,
    deviceMemoryGiB: globalThis.navigator.deviceMemory ?? null, isolated: globalThis.crossOriginIsolated }));
  for (const c of manifest.clips) {
    const beginErrors = pageErrors.length;
    let watchdog;
    try {
      const filename = c.path.split('/').at(-1);
      const result = await Promise.race([
        importBatch(page, [c.absolutePath], [filename], 180_000),
        new Promise((_, reject) => { watchdog = setTimeout(() => {
          report.aborted = 'Import deadline exceeded';
          void page.close().catch(() => {});
          reject(new Error('Import deadline exceeded; browser session ended'));
        }, 181_000); }),
      ]);
      const graph = await page.evaluate(savedGraph, true);
      const node = graph?.nodes.find(n => (n.path ?? n.title) === filename);
      const audio = node?.audio;
      const row = { id: c.id, status: audio?.recognition?.status ?? 'failed', cold: report.rows.length === 0,
        elapsedMs: result.elapsedMs, peakPageHeapBytes: result.peakJsHeapBytes, timedOut: result.timedOut,
        labels: audio ? confidentSoundSummary(audio, audio.recognition?.mode).map(s => `${s.dimension}:${s.label}`) : [],
        tempo: audio?.tempo?.bpm ?? null, key: audio?.key?.source === 'filename' ? null : audio?.key ?? null,
        embedding: audio?.embedding, notes: audio?.notes, runtime: result.stats,
        errors: pageErrors.slice(beginErrors) };
      if (result.timedOut) row.status = 'failed';
      report.rows.push(row);
      writeFileSync(join(output, `${c.id}.json`), JSON.stringify(audio ?? null));
      console.log(JSON.stringify({ id: c.id, status: row.status, elapsedMs: row.elapsedMs, tempo: row.tempo, key: row.key, labels: row.labels }));
    } catch (e) { report.rows.push({ id: c.id, status: 'failed', error: String(e) }); }
    finally { clearTimeout(watchdog); }
    writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2));
    if (report.aborted || page.isClosed()) { report.aborted ??= 'Browser closed'; break; }
  }
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await browser?.close(); server.kill();
  writeFileSync(join(output, 'run.json'), JSON.stringify(report, null, 2));
}
if (report.rows.some(r => r.status !== 'complete')) process.exitCode = 1;
