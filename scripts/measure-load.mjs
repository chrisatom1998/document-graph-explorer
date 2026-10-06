#!/usr/bin/env node
/* global document, indexedDB */
// Load-time benchmark for the BUILT app (run `npm run build` first).
// Starts `vite preview`, then in headless Chromium measures, on a cold and a
// warm browser profile: time until the welcome screen is usable, bytes fetched
// while the app sits idle (speculative model warmup), demo-corpus ingest time,
// and time to analyse one track and a small library. Prints JSON.
//
//   node scripts/measure-load.mjs [--audio <dir>] [--idle 60] [--skip-demo] [--out file.json]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const IDLE_S = Number(opt('idle', 60));
const AUDIO_DIR = opt('audio');
const OUT = opt('out');
const SKIP_DEMO = args.includes('--skip-demo');
const PORT = Number(opt('port', 4199));
const PROXY_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PROXY_PORT}`;

// Byte counts come from a pass-through proxy in front of `vite preview`: the
// browser cannot report sizes for chunked worker responses, the server can.
let served = [];
let t0 = Date.now();
function startProxy() {
  const server = http.createServer((req, res) => {
    const upstream = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers }, up => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      let bytes = 0;
      let logged = false;
      // Count cancelled responses too: bytes the browser fetched and threw away still cost bandwidth.
      const record = () => { if (!logged) { logged = true; served.push({ at: Date.now() - t0, path: new URL(req.url, BASE).pathname, status: up.statusCode, bytes }); } };
      up.on('data', chunk => { bytes += chunk.length; });
      up.on('end', record);
      res.on('close', record);
      up.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  return new Promise(r => server.listen(PROXY_PORT, '127.0.0.1', () => r(server)));
}

async function startPreview() {
  // A leftover server on this port would silently serve some other build.
  if (await fetch(`http://127.0.0.1:${PORT}`).then(() => true, () => false)) throw new Error(`port ${PORT} is already serving; pass --port`);
  const child = spawn('npx', ['vite', 'preview', '--outDir', opt('dist', 'dist'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
  const stop = () => { try { process.kill(-child.pid); } catch { /* already gone */ } };
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`vite preview exited; is port ${PORT} already in use?`);
    try { if ((await fetch(`http://127.0.0.1:${PORT}`)).ok) return { kill: stop }; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  stop();
  throw new Error('vite preview did not start');
}

const sum = rows => rows.reduce((n, r) => n + r.bytes, 0);
const mb = n => Math.round(n / 1e5) / 10;
function topFiles(rows, n = 12) {
  const by = new Map();
  for (const r of rows) by.set(r.path, (by.get(r.path) ?? 0) + r.bytes);
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, n).map(([path, bytes]) => ({ path, mb: mb(bytes) }));
}

async function audioFiles() {
  if (!AUDIO_DIR) return [];
  const dir = resolve(AUDIO_DIR);
  return (await readdir(dir)).filter(f => /\.(wav|mp3|flac|ogg|m4a|aiff?)$/i.test(f)).sort().map(f => join(dir, f));
}

async function dropFiles(page, files) {
  const chooser = page.waitForEvent('filechooser');
  const empty = page.getByRole('button', { name: 'Add files', exact: true });
  if (await empty.isVisible()) await empty.click();
  else {
    await page.getByRole('button', { name: 'Add documents' }).click();
    await page.locator('.toolbar__menu button[title="Add files"]').click();
  }
  await (await chooser).setFiles(files);
}

async function waitIdle(page, timeout) {
  await page.getByRole('button', { name: 'Search documents' }).waitFor({ state: 'visible', timeout });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === 'Search documents' || el.textContent?.trim() === 'Search documents');
    return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  }, null, { timeout, polling: 250 });
}

async function run(label, userDataDir, files, { freshWorkspace = false } = {}) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 800, height: 500 },
    reducedMotion: 'reduce',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = context.pages()[0] ?? await context.newPage();
  t0 = Date.now();
  served = [];
  const log = served;
  if (freshWorkspace) {
    // Returning visitor with new files: keep the HTTP cache and Cache API
    // (downloaded models) but drop the saved workspace and analysis caches.
    await page.goto(BASE + '/manifest.webmanifest');
    await page.evaluate(async () => {
      const audioUsed = localStorage.getItem('dge-audio-analysis-used');
      localStorage.clear(); sessionStorage.clear();
      if (audioUsed) localStorage.setItem('dge-audio-analysis-used', audioUsed);
      for (const db of await indexedDB.databases()) if (db.name) await new Promise(r => { const q = indexedDB.deleteDatabase(db.name); q.onsuccess = q.onerror = q.onblocked = r; });
      try { const root = await navigator.storage.getDirectory(); for await (const name of root.keys()) await root.removeEntry(name, { recursive: true }); } catch { /* no OPFS */ }
    });
    t0 = Date.now();
    served.length = 0;
  }
  const result = { label };
  const start = Date.now();
  await page.goto(BASE + '/');
  const ready = page.getByRole('button', { name: 'Load demo corpus' }).or(page.getByRole('button', { name: 'Search documents' }));
  await ready.first().waitFor({ state: 'visible', timeout: 120_000 });
  result.welcomeMs = Date.now() - start;
  const all = () => log;
  result.bytesAtWelcomeMB = mb(sum(all().filter(r => r.at <= result.welcomeMs)));
  await page.waitForTimeout(IDLE_S * 1000);
  result.idleSeconds = IDLE_S;
  result.bytesAfterIdleMB = mb(sum(all()));
  result.topAfterIdle = topFiles(all());
  console.error(label, JSON.stringify(result));
  if (!SKIP_DEMO && await page.getByRole('button', { name: 'Load demo corpus' }).isVisible()) {
    const guide = page.getByRole('button', { name: 'Dismiss getting started' });
    if (await guide.isVisible()) await guide.click();
    const before = Date.now() - t0;
    const t = Date.now();
    await page.getByRole('button', { name: 'Load demo corpus' }).click();
    await page.locator('.graph-navigator__summary').filter({ hasText: '100 documents' }).waitFor({ timeout: 600_000 });
    await waitIdle(page, 600_000);
    result.demoIngestMs = Date.now() - t;
    result.demoBytesMB = mb(sum(all().filter(r => r.at >= before)));
    console.error(label, JSON.stringify(result));
  }
  if (files.length) {
    const before = Date.now() - t0;
    let t = Date.now();
    await dropFiles(page, files.slice(0, 1));
    await page.waitForTimeout(500);
    await waitIdle(page, 900_000);
    result.oneTrackMs = Date.now() - t;
    result.oneTrackBytesMB = mb(sum(all().filter(r => r.at >= before)));
    console.error(label, JSON.stringify(result));
    if (files.length > 1) {
      t = Date.now();
      await dropFiles(page, files.slice(1));
      await page.waitForTimeout(500);
      await waitIdle(page, 1_800_000);
      result.libraryTracks = files.length - 1;
      result.libraryMs = Date.now() - t;
    }
    result.topDuringAudio = topFiles(all().filter(r => r.at >= before), 8);
    // Saved analyses, so a before/after pair can be checked for identical results.
    result.analyses = await page.evaluate(async () => {
      const out = {};
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((r, j) => { const q = indexedDB.open(info.name); q.onsuccess = () => r(q.result); q.onerror = j; });
        for (const store of db.objectStoreNames) {
          const tx = db.transaction(store);
          const [keys, values] = await Promise.all(['getAllKeys', 'getAll'].map(m => new Promise(r => { const q = tx.objectStore(store)[m](); q.onsuccess = () => r(q.result); })));
          keys.forEach((k, i) => { if (typeof k === 'string' && k.startsWith('music-analysis:')) out[k] = values[i]; });
        }
        db.close();
      }
      return out;
    });
  }
  result.totalMB = mb(sum(all()));
  await context.close();
  return result;
}

const server = await startPreview();
const proxy = await startProxy();
const profile = await mkdtemp(join(tmpdir(), 'dge-load-'));
try {
  const files = await audioFiles();
  // cold: empty profile. warm: same profile reopened with its saved workspace.
  // warm-new-files: same caches, empty workspace, demo and audio again.
  const cold = await run('cold', profile, files);
  const warm = await run('warm', profile, []);
  const warmNewFiles = await run('warm-new-files', profile, files, { freshWorkspace: true });
  const report = { when: new Date().toISOString(), cold, warm, warmNewFiles };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (OUT) await writeFile(OUT, text);
} finally {
  server.kill();
  proxy.close();
  await rm(profile, { recursive: true, force: true });
}
