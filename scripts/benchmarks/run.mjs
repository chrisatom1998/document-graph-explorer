// Real built-app benchmark. No model mocks and no access to an existing user profile.
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { hash, inspectGraph, manifestDigest, percentile, validateManifest } from './core.mjs';
import { exportGraph, importBatch, installObserver, writeReport } from './browser.mjs';

const [mode, manifestPath, outputArg, ...args] = process.argv.slice(2);
if (!['accuracy', 'import'].includes(mode) || !manifestPath || !outputArg) {
  throw new Error('Usage: node scripts/benchmarks/run.mjs <accuracy|import> <manifest.json> <new-output-dir> [--counts=10,100,500] [--repeats=3] [--timeout=1800] [--port=4295] [--split=development] [--dist=dist]');
}
const options = {};
for (const arg of args) {
  const match = /^--(counts|repeats|timeout|port|split|dist)=(.+)$/.exec(arg);
  if (!match || Object.hasOwn(options, match[1])) throw new Error(`Unknown/duplicate option: ${arg}`);
  options[match[1]] = match[2];
}
function integer(value, name, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}
const repeats = integer(options.repeats ?? 3, 'repeats', 30);
const timeoutMs = integer(options.timeout ?? 1800, 'timeout seconds', 14400) * 1000;
const port = integer(options.port ?? 4295, 'port', 65535);
const split = options.split ?? (mode === 'accuracy' ? 'test' : 'development');
if (!['development', 'test'].includes(split)) throw new Error('Invalid split');
if (mode === 'import' && split !== 'development') throw new Error('Performance tuning uses development audio; preserve the test split for accuracy');
const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
const output = resolve(outputArg), dist = resolve(options.dist ?? 'dist');
if (existsSync(output)) throw new Error('Output already exists; use a new directory to preserve earlier results');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Build the production app first: npm run build');
const audioRoot = join(dirname(resolve(manifestPath)), 'audio');
const selected = manifest.clips.filter(c => c.split === split);
if (!selected.length) throw new Error(`No clips in ${split}`);
const counts = mode === 'accuracy' ? [selected.length] : (options.counts ?? '10,100,500').split(',').map(n => integer(n, 'count', 10000));
if (new Set(counts).size !== counts.length) throw new Error('Duplicate batch counts');
if (mode === 'import' && Math.max(...counts) + 1 > selected.length) throw new Error('Need count + 1 distinct development clips (one unseen warmup); audio is never duplicated to fill a batch');
for (const clip of selected) {
  if (hash(readFileSync(join(audioRoot, clip.file))) !== clip.sha256) throw new Error(`Audio checksum mismatch: ${clip.id}`);
}
const digest = manifestDigest(manifest);
const sealPath = join(dirname(resolve(manifestPath)), 'manifest.sha256');
if (existsSync(sealPath) && readFileSync(sealPath, 'utf8').trim() !== digest) throw new Error('Frozen manifest checksum mismatch');

// Bind results to actual deployed bytes, not only the working-tree commit.
async function buildDigest(root) {
  const h = createHash('sha256');
  async function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        h.update(path.slice(root.length)); h.update('\0');
        const fileHash = createHash('sha256');
        for await (const chunk of createReadStream(path)) fileHash.update(chunk);
        h.update(fileHash.digest());
      }
    }
  }
  await visit(root); return h.digest('hex');
}
let commit = null, dirty = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
} catch { /* Source may be a release archive; deployed bytes still identify it. */ }
const report = { version: 1, mode, split, at: new Date().toISOString(), commit, dirty,
  manifestSha256: digest, buildSha256: await buildDigest(dist), node: process.version,
  platform: process.platform, runs: [],
  boundaries: 'File-picker handoff through complete saved graph, including 500ms polling and 1.5s stability wait; excludes directory enumeration and export time.',
  memoryScope: 'Sampled page JS heap only, not worker/WASM/GPU/browser RSS. Null means unsupported.',
  instrumentation: 'Worker request wall times overlap and include queue/load/cache work; not isolated inference CPU time. IndexedDB transaction times also overlap.',
};
mkdirSync(output, { recursive: true });
writeReport(join(output, 'manifest.json'), manifest);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', dist], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = '', serverExited = false;
server.stdout.on('data', c => { serverError = (serverError + c).slice(-3000); });
server.stderr.on('data', c => { serverError = (serverError + c).slice(-3000); });
server.on('error', e => { serverError += e.message; serverExited = true; });
server.on('exit', () => { serverExited = true; });
let browser;
const stop = () => server.kill();
process.once('exit', stop);
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (serverExited) throw new Error(`Preview failed: ${serverError}`);
    // Wait for our own listener, never silently benchmark a server already on the port.
    if (serverError.includes('127.0.0.1')) {
      try { ready = (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
    }
    if (ready) break;
    await delay(500);
  }
  if (!ready || serverExited) throw new Error(`Preview did not start: ${serverError}`);
  const { chromium } = await import('@playwright/test');
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  report.browser = browser.version();

  async function withSession(run) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce', acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', request => requests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    await page.addInitScript(installObserver);
    await page.addInitScript(() => globalThis.localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: 'full' })));
    try {
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add files', exact: true }).waitFor();
      report.hardware = await page.evaluate(() => ({ cores: globalThis.navigator.hardwareConcurrency,
        deviceMemoryGiB: globalThis.navigator.deviceMemory ?? null, userAgent: globalThis.navigator.userAgent,
        isolated: globalThis.crossOriginIsolated }));
      await run(page, context, errors, requests);
    } finally { await context.close(); }
  }
  async function measured(page, context, clips, label, repeat, errors, requests) {
    const errorStart = errors.length, requestStart = requests.length;
    let watchdog;
    try {
      const result = await Promise.race([
        importBatch(page, clips.map(c => join(audioRoot, c.file)), clips.map(c => c.file), timeoutMs),
        new Promise((_, reject) => {
          watchdog = setTimeout(() => { void context.close().catch(() => {}); reject(new Error('Import deadline exceeded')); }, timeoutMs + 1000);
        }),
      ]);
      result.pageErrors = errors.slice(errorStart); result.requestFailures = requests.slice(requestStart);
      result.valid = !result.timedOut && result.complete === clips.length && result.pageErrors.length === 0;
      const record = { scenario: label, repeat, count: clips.length, ...result };
      report.runs.push(record); writeReport(join(output, 'run.json'), report);
      console.log(JSON.stringify({ scenario: label, repeat, count: clips.length, ms: result.elapsedMs, complete: result.complete, valid: result.valid }));
      return result;
    } catch (error) {
      report.runs.push({ scenario: label, repeat, count: clips.length, valid: false, error: error.message });
      writeReport(join(output, 'run.json'), report); throw error;
    } finally { clearTimeout(watchdog); }
  }
  if (mode === 'accuracy') {
    await withSession(async (page, context, errors, requests) => {
      await measured(page, context, selected, 'blind-test', 1, errors, requests);
      const graph = await exportGraph(page, output);
      if (inspectGraph(graph, selected.map(c => c.file)).complete !== selected.length) throw new Error('Export does not contain every complete test clip');
    });
  } else {
    for (const count of counts) for (let repeat = 1; repeat <= repeats; repeat++) {
      const clips = selected.slice(0, count);
      await withSession(async (page, context, errors, requests) => {
        await measured(page, context, clips, 'cold-profile', repeat, errors, requests);
        await measured(page, context, clips, 'cached-reimport', repeat, errors, requests);
      });
      await withSession(async (page, context, errors, requests) => {
        const warmup = await measured(page, context, [selected[count]], 'warmup', repeat, errors, requests);
        if (!warmup.valid) throw new Error('Warmup failed; refusing to call the next run warm');
        await measured(page, context, clips, 'warm-unseen', repeat, errors, requests);
      });
    }
  }
  report.summary = [];
  for (const scenario of ['cold-profile', 'warm-unseen', 'cached-reimport']) for (const count of counts) {
    const runs = report.runs.filter(r => r.scenario === scenario && r.count === count);
    if (!runs.length) continue;
    const valid = runs.filter(r => r.valid), times = valid.map(r => r.elapsedMs);
    report.summary.push({ scenario, count, attempted: runs.length, valid: valid.length,
      medianMs: percentile(times, .5), observedP95Ms: percentile(times, .95),
      p95Warning: valid.length < 20 ? 'Small sample: observed percentile, not a stable population p95' : null,
      medianClipsPerSecond: times.length ? count * 1000 / percentile(times, .5) : null });
  }
  report.valid = report.runs.length > 0 && report.runs.every(r => r.valid);
  if (!report.valid) process.exitCode = 1;
} catch (error) {
  report.valid = false; report.error = error.message; process.exitCode = 1;
  console.error(error.message);
} finally {
  writeReport(join(output, 'run.json'), report);
  await browser?.close(); server.kill(); process.removeListener('exit', stop);
}
