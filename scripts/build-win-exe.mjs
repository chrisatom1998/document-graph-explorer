// Builds release/win/run.exe as a Node.js Single Executable Application (SEA)
// — no third-party packager. Replaces `pkg`, which is archived upstream,
// carries an unfixable privilege-escalation advisory (GHSA-22r3-9w55-cj54),
// and could only target the end-of-life Node 18 runtime.
//
// Pipeline (all cross-platform; CI runs it on Linux):
//   1. esbuild bundles scripts/serve-exe.cjs + staticServer.cjs into ONE CJS
//      file — a SEA main script's require() resolves builtins only.
//   2. `node --experimental-sea-config` writes the SEA blob with the host Node.
//   3. Download the official Windows node.exe of the SAME version as the host
//      (blob layout is version-coupled) and verify it against SHASUMS256.txt.
//   4. postject injects the blob as a PE resource and flips the SEA fuse.
// scripts/set-exe-icon.mjs then brands the exe (and drops the now-invalid
// Authenticode signature); scripts/stage-win-release.mjs lays out release/win.
//
// `--self-test` additionally builds a SEA from the host's own node binary,
// starts it against dist/, and checks it serves the app — proving the blob
// and the bundled launcher work end to end on this Node version.
import { build } from 'esbuild';
import { inject } from 'postject';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');

const NODE_VERSION = process.env.WIN_NODE_VERSION || process.version; // e.g. v24.21.0
const DIST_BASE = (process.env.NODE_DIST_BASE || 'https://nodejs.org/dist').replace(/\/$/, '');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const workDir = path.join(repoRoot, 'release', 'sea');
const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'node-win');
const bundlePath = path.join(workDir, 'serve-exe.bundle.cjs');
const seaConfigPath = path.join(workDir, 'sea-config.json');
const blobPath = path.join(workDir, 'serve-exe.blob');
const outDir = path.join(repoRoot, 'release', 'win');
const exePath = path.join(outDir, 'run.exe');

const rel = (p) => path.relative(repoRoot, p);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchBytes(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw new Error(`Download failed after four attempts: ${url}`, { cause: error });
      console.warn(`build-win-exe: download attempt ${attempt + 1} failed; retrying ${url}`);
      await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
    }
  }
}

async function bundleLauncher() {
  mkdirSync(workDir, { recursive: true });
  const major = Number(process.versions.node.split('.')[0]);
  await build({
    entryPoints: [path.join(repoRoot, 'scripts', 'serve-exe.cjs')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: `node${major}`,
    outfile: bundlePath,
    logLevel: 'silent',
  });
  console.log(`Bundled launcher -> ${rel(bundlePath)}`);
}

function writeBlob() {
  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        // The code cache is V8-build-specific; the blob is injected into a
        // different platform's binary, so compile at startup instead.
        useCodeCache: false,
        useSnapshot: false,
      },
      null,
      2,
    ),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });
  console.log(`Wrote SEA blob -> ${rel(blobPath)}`);
}

async function windowsNodeBinary() {
  mkdirSync(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `node-${NODE_VERSION}-win-x64.exe`);
  if (existsSync(cached)) {
    console.log(`Using cached Windows runtime ${rel(cached)}`);
    return readFileSync(cached);
  }
  const zipName = `node-${NODE_VERSION}-win-x64.zip`;
  const [zip, sums] = await Promise.all([
    fetchBytes(`${DIST_BASE}/${NODE_VERSION}/${zipName}`),
    fetchBytes(`${DIST_BASE}/${NODE_VERSION}/SHASUMS256.txt`),
  ]);
  const expected = sums
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === zipName)?.[0];
  if (!expected) throw new Error(`SHASUMS256.txt has no entry for ${zipName}`);
  const actual = sha256(zip);
  if (actual !== expected) throw new Error(`Checksum mismatch for ${zipName}: expected ${expected}, got ${actual}`);
  const archive = await JSZip.loadAsync(zip);
  const entry = archive.file(`node-${NODE_VERSION}-win-x64/node.exe`);
  if (!entry) throw new Error(`node.exe not found inside ${zipName}`);
  const exe = await entry.async('nodebuffer');
  writeFileSync(cached, exe);
  console.log(`Downloaded + verified Windows runtime ${NODE_VERSION} -> ${rel(cached)}`);
  return exe;
}

async function injectBlob(targetPath, blob) {
  await inject(targetPath, 'NODE_SEA_BLOB', blob, { sentinelFuse: SEA_FUSE });
  const out = readFileSync(targetPath);
  if (!out.includes(`${SEA_FUSE}:1`)) throw new Error(`SEA fuse was not flipped in ${rel(targetPath)}`);
}

async function selfTest(blob) {
  const testDir = path.join(workDir, 'selftest');
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  const bin = path.join(testDir, process.platform === 'win32' ? 'run.exe' : 'run');
  copyFileSync(process.execPath, bin);
  chmodSync(bin, 0o755);
  // The launcher serves the dist/ folder that sits beside the executable.
  symlinkSync(path.join(repoRoot, 'dist'), path.join(testDir, 'dist'), 'junction');
  await injectBlob(bin, blob);

  const port = 18317 + Math.floor(Math.random() * 1000);
  const child = spawn(bin, [], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    let html = null;
    for (let i = 0; i < 50 && html === null; i++) {
      await new Promise((done) => setTimeout(done, 200));
      if (child.exitCode !== null) break;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) html = await res.text();
      } catch {
        /* not listening yet */
      }
    }
    if (html === null || !html.includes('<html')) {
      throw new Error(`SEA self-test: launcher did not serve index.html on :${port}\n${log}`);
    }
    const model = await fetch(`http://127.0.0.1:${port}/models/Xenova/bge-small-en-v1.5/config.json`);
    if (!model.ok) throw new Error(`SEA self-test: model asset returned HTTP ${model.status}`);
    const escape = await fetch(`http://127.0.0.1:${port}/..%2f..%2fpackage.json`);
    if (escape.ok) throw new Error('SEA self-test: path traversal was not refused');
    console.log(`SEA self-test OK — host-platform SEA served dist/ on :${port}`);
  } finally {
    child.kill();
  }
}

async function main() {
  if (!existsSync(path.join(repoRoot, 'dist', 'index.html'))) {
    console.error('dist/ build not found - run: npm run build');
    process.exit(1);
  }
  rmSync(workDir, { recursive: true, force: true });
  await bundleLauncher();
  writeBlob();
  const blob = readFileSync(blobPath);
  if (SELF_TEST) await selfTest(blob);

  const nodeExe = await windowsNodeBinary();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(exePath, nodeExe);
  await injectBlob(exePath, blob);
  console.log(`Built ${rel(exePath)} (Node ${NODE_VERSION} SEA, ${(readFileSync(exePath).length / 1048576).toFixed(1)} MB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
