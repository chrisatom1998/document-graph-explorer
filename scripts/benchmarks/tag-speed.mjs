// Tagging speed on a fixed set of short clips cut from the committed Iowa fixtures.
// Cold model load, warm per-clip tag latency (median and observed p95), and clips
// per second. Runs the built app. No model mocks and no learned-head edits.
//
// Usage: npm run bench:tag-speed -- <new-output.json> [--port=4297] [--timeout=600] [--dist=dist]
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { confidentSoundSummary } from '../../src/audio/confidentSoundSummary';
import { installObserver } from './browser.mjs';
import { fastestReliable, summarizeMethod } from './tag-speed-score.mjs';
import { slicePcmWav } from './wavSlice.mjs';

const [outputArg, ...args] = process.argv.slice(2);
if (!outputArg || outputArg.startsWith('--')) {
  throw new Error('Usage: npm run bench:tag-speed -- <new-output.json> [--port=4297] [--timeout=600] [--dist=dist]');
}
const options = {};
for (const arg of args) {
  const match = /^--(port|timeout|dist)=(.+)$/.exec(arg);
  if (!match || Object.hasOwn(options, match[1])) throw new Error(`Unknown/duplicate option: ${arg}`);
  options[match[1]] = match[2];
}
function integer(value, name, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}
const timeoutMs = integer(options.timeout ?? 600, 'timeout seconds', 3600) * 1000;
const port = integer(options.port ?? 4297, 'port', 65535);
const dist = resolve(options.dist ?? 'dist');
const output = resolve(outputArg);
if (existsSync(output)) throw new Error('Output already exists; use a new file to preserve earlier results');
mkdirSync(dirname(output), { recursive: true });
if (!existsSync(join(dist, 'index.html'))) throw new Error('Build the production app first: npm run build');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureDir = join(tmpdir(), `dge-tag-speed-${process.pid}`);
mkdirSync(fixtureDir, { recursive: true });
const flute = readFileSync('src/audio/sourceMatching/testfixtures/iowa-flute-first8s.wav');
const marimba = readFileSync('src/audio/sourceMatching/testfixtures/iowa-marimba-C7.wav');
const clips = [];
// Two-second windows from the opening of the flute take, plus the whole marimba note.
for (const [name, start, role] of [['flute-0.wav', 0, 'cold'], ['flute-a.wav', 0.5, 'warm'], ['flute-b.wav', 1, 'warm'], ['flute-1.wav', 2, 'warm']]) {
  const bytes = slicePcmWav(flute, start, 2);
  writeFileSync(join(fixtureDir, name), bytes);
  clips.push({ name, role, seconds: 2, startSeconds: start, sha256: hash(bytes), source: 'iowa-flute-first8s.wav' });
}
writeFileSync(join(fixtureDir, 'marimba-hit.wav'), marimba);
clips.push({ name: 'marimba-hit.wav', role: 'warm', seconds: null, sha256: hash(marimba), source: 'iowa-marimba-C7.wav' });

let commit = null, dirty = null;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
} catch { /* Source may be a release archive. */ }

const report = {
  version: 1,
  mode: 'tag-speed',
  at: new Date().toISOString(),
  commit,
  dirty,
  node: process.version,
  platform: process.platform,
  machine: { cpuModel: cpus()[0]?.model ?? null, cpus: cpus().length, totalMemBytes: totalmem() },
  fixtures: clips,
  boundaries: 'Per clip: file-picker handoff until the saved graph holds audio that confidentSoundSummary shows as at least one tag. Includes up to 250ms polling and the app save delay. Excludes the later UI click used only to confirm the tag is on screen. Cold model load is the wall clock of kind:"warm" preloads when the app sends them, otherwise the sum of (first cold request − warm median) across worker kinds.',
  methods: [],
};
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', dist], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '', serverExited = false;
server.stdout.on('data', chunk => { serverLog = (serverLog + chunk).slice(-3000); });
server.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-3000); });
server.on('error', error => { serverLog += error.message; serverExited = true; });
server.on('exit', () => { serverExited = true; });
let browser;
const stop = () => server.kill();
process.once('exit', stop);

function labelsOf(audio) {
  if (!audio) return [];
  try { return confidentSoundSummary(audio).map(label => label.label); }
  catch { return []; }
}

async function readClip(page, name) {
  return page.evaluate(async clipName => {
    const db = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open('knowledge-nebula');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('corpora')) return null;
      const records = await new Promise((resolve, reject) => {
        const request = db.transaction('corpora').objectStore('corpora').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const graph = records.sort((a, b) => b.updatedAt - a.updatedAt).find(record => record.exportData)?.exportData;
      if (!graph?.nodes) return null;
      const want = clipName.toLowerCase();
      const title = want.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const node = graph.nodes.find(item => {
        const path = String(item.path || '').toLowerCase();
        const named = String(item.title || '').toLowerCase();
        return path.endsWith(want) || named === title;
      });
      return node?.audio ?? null;
    } finally { db.close(); }
  }, name);
}

async function stats(page) {
  return page.evaluate(() => {
    const live = globalThis.__dgeBenchmark;
    return {
      pending: live.pending,
      requests: live.requests.map(request => ({ kind: request.kind, ms: request.ms, start: request.start, inferenceExecuted: request.inferenceExecuted, failed: request.failed })),
      warmSpans: live.warmSpans.map(span => ({ start: span.start, end: span.end })),
    };
  });
}

try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (serverExited) throw new Error(`Preview failed: ${serverLog}`);
    if (serverLog.includes('127.0.0.1')) {
      try { ready = (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* starting */ }
    }
    if (ready) break;
    await delay(500);
  }
  if (!ready || serverExited) throw new Error(`Preview did not start: ${serverLog}`);
  const { chromium } = await import('@playwright/test');
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  report.browser = browser.version();

  for (const method of ['fast', 'full']) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', dialog => { pageErrors.push(`dialog: ${dialog.message()}`); void dialog.dismiss(); });
    await page.addInitScript(installObserver);
    await page.addInitScript(mode => {
      localStorage.setItem('knowledge-nebula-settings', JSON.stringify({ musicAnalysisMode: mode }));
    }, method);
    const measured = [];
    try {
      await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add files', exact: true }).waitFor();
      report.hardware ??= await page.evaluate(() => ({
        cores: navigator.hardwareConcurrency,
        deviceMemoryGiB: navigator.deviceMemory ?? null,
        userAgent: navigator.userAgent,
        isolated: globalThis.crossOriginIsolated,
      }));
      for (const clip of clips) {
        const errorStart = pageErrors.length;
        await page.evaluate(() => {
          const live = globalThis.__dgeBenchmark;
          live.epoch++;
          live.requests = [];
          live.warmSpans = [];
        });
        const picker = page.locator('body > input[type="file"][multiple]:not([webkitdirectory])');
        if (!await picker.count()) {
          await page.getByRole('button', { name: 'Add files', exact: true }).click();
        }
        const started = Date.now();
        await picker.setInputFiles(join(fixtureDir, clip.name));
        let tagMs = null;
        let audio = null;
        while (Date.now() - started < timeoutMs) {
          audio = await readClip(page, clip.name);
          if (labelsOf(audio).length) { tagMs = Date.now() - started; break; }
          const live = await stats(page);
          // A finished analysis with no displayed tag will not grow one by waiting.
          if (live.pending === 0 && audio && audio.stage !== 'preview' && audio.recognition?.status) break;
          await page.waitForTimeout(250);
        }
        // Let a background full pass finish so the next clip is not queued behind it.
        // Cap the wait: tagMs above already stopped at the first displayed tag.
        const settleDeadline = Date.now() + Math.min(timeoutMs, 180_000);
        let settled = false;
        while (Date.now() < settleDeadline) {
          const live = await stats(page);
          audio = await readClip(page, clip.name);
          if (live.pending === 0 && audio && audio.stage !== 'preview') { settled = true; break; }
          await page.waitForTimeout(250);
        }
        const live = await stats(page);
        const labels = labelsOf(audio);
        const record = {
          name: clip.name,
          role: clip.role,
          tagMs,
          tagged: labels.length > 0,
          labels,
          stage: audio?.stage ?? null,
          recognition: audio?.recognition?.status ?? null,
          settled,
          requests: live.requests,
          warmSpans: live.warmSpans,
          pageErrors: pageErrors.slice(errorStart),
          failed: tagMs == null || labels.length === 0,
        };
        measured.push(record);
        console.log(JSON.stringify({ method, name: clip.name, role: clip.role, tagMs, tagged: record.tagged, labels, settled }));
        if (record.failed) break;
      }
      if (measured.every(clip => clip.tagged)) {
        for (const clip of measured) {
          try {
            await page.getByRole('button', { name: 'Search documents' }).click();
            const title = clip.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
            await page.locator('.search-result-row').filter({ hasText: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click({ timeout: 90_000 });
            await page.getByRole('region', { name: 'Sound identification' }).locator('.sound-tag:not(.sound-tag--name)').first().waitFor({ timeout: 90_000 });
            clip.uiTag = true;
            await page.keyboard.press('Escape');
          } catch (error) {
            clip.uiTag = false;
            clip.failed = true;
            clip.pageErrors.push(error.message);
          }
        }
      }
    } finally {
      await context.close();
    }
    const summary = summarizeMethod(method, measured);
    if (measured.some(clip => clip.uiTag === false)) summary.reliable = false;
    report.methods.push({ ...summary, clips: measured.map(clip => ({ ...clip, requests: clip.requests, warmSpans: clip.warmSpans })) });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  report.fastestReliable = fastestReliable(report.methods);
  report.valid = Boolean(report.fastestReliable);
  if (!report.valid) process.exitCode = 1;
} catch (error) {
  report.valid = false;
  report.error = error.message;
  process.exitCode = 1;
  console.error(error);
} finally {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  server.kill();
  process.removeListener('exit', stop);
}
