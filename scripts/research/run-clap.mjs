// Isolated production CLAP worker baseline. No AST, tagger, graph or display policy.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus } from 'node:os';
import { chromium } from '@playwright/test';
import { digest, loadManifest } from './core.mjs';
const [file, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node run-clap.mjs manifest.json new-run.json');
if (existsSync(output)) throw new Error('Refusing to overwrite results');
mkdirSync(dirname(output), { recursive: true });
const manifest = loadManifest(file);
const workerAsset = readdirSync('dist/assets').find(f => /^musicAnalysis\.worker-.*\.js$/.test(f));
if (!workerAsset) throw new Error('Build the app first');
const port = process.env.DGE_RESEARCH_PORT ?? '4301';
const report = { model: 'dge-clap-component', manifestSha256: digest(readFileSync(file)),
  at: new Date().toISOString(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, rows: [],
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  boundary: 'ffmpeg mono 48 kHz decode, IPC, unchanged built production CLAP profile worker; no graph, AST, tagger, display-policy or browser-file-picker work. Fresh context, sequential clips.' };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort']);
let browser, ready = false;
server.stdout.on('data', b => { ready ||= String(b).includes('127.0.0.1'); });
try {
  for (let n = 0; n < 100 && !ready; n++) await new Promise(r => setTimeout(r, 100));
  if (!ready) throw new Error('Preview did not start');
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  report.browser = browser.version();
  const page = await browser.newPage();
  // Keep the origin and COOP/COEP headers, without starting the app's graph UI.
  await page.route(`http://127.0.0.1:${port}/`, route => route.fulfill({ contentType: 'text/html',
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }, body: '<html><body>CLAP evaluation</body></html>' }));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(asset => { globalThis.researchWorker = new globalThis.Worker(`/assets/${asset}`, { type: 'module' }); }, workerAsset);
  for (const [i, clip] of manifest.clips.entries()) {
    const started = performance.now();
    try {
      const bytes = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', clip.absolutePath, '-f', 'f32le', '-ar', '48000', '-ac', '1', 'pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
      const samples = Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
      const data = await page.evaluate(({ id, samples }) => new Promise((resolve, reject) => {
        const worker = globalThis.researchWorker;
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('CLAP deadline exceeded')); }, 90000);
        worker.onmessage = ({ data }) => {
          if (data.id !== id || data.progress) return;
          clearTimeout(timer);
          if (data.error) reject(new Error(data.error)); else resolve(data);
        };
        worker.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
        const pcm = Float32Array.from(samples);
        worker.postMessage({ id, kind: 'profile', samples: pcm }, [pcm.buffer]);
      }), { id: i, samples });
      const embedding = data.result.find(r => r.group === 'embedding')?.embedding;
      if (!embedding) throw new Error('No embedding returned');
      report.rows.push({ id: clip.id, status: 'complete', cold: i === 0,
        elapsedMs: performance.now() - started, embedding, runtime: data.runtime });
    } catch (error) {
      report.rows.push({ id: clip.id, status: 'failed', error: String(error), elapsedMs: performance.now() - started });
      report.aborted = 'Worker failure; remaining clips unmeasured';
    }
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(clip.id, report.rows.at(-1).status);
    if (report.aborted) break;
  }
} catch (error) { report.error = String(error); throw error; }
finally { await browser?.close(); server.kill(); writeFileSync(output, JSON.stringify(report, null, 2)); }
if (report.aborted || report.rows.some(r => r.status !== 'complete')) process.exitCode = 1;
