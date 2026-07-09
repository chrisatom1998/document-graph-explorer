// Copies dist/ next to the packaged run.exe under release/win/, and copies
// the exe itself into docker/downloads/ so it can be served by nginx (see
// docker-compose.yml's `./docker/downloads:/usr/share/nginx/downloads:ro`
// bind mount and docker/nginx.conf's `/downloads/` location). The exe
// serves the dist folder that sits beside it (see serve-exe.cjs APP_BASE),
// so release/win/ is a self-contained folder you can zip and ship:
//   release/win/run.exe  + release/win/dist/
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const distDir = path.join(repoRoot, 'dist');
const stagedDist = path.join(repoRoot, 'release', 'win', 'dist');
const exePath = path.join(repoRoot, 'release', 'win', 'run.exe');
const downloadsDir = path.join(repoRoot, 'docker', 'downloads');

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/ build not found - run: npm run build');
  process.exit(1);
}

rmSync(stagedDist, { recursive: true, force: true });
cpSync(distDir, stagedDist, { recursive: true });
console.log(`Staged dist/ -> ${path.relative(repoRoot, stagedDist)}`);

if (existsSync(exePath)) {
  mkdirSync(downloadsDir, { recursive: true });
  const stagedExeName = 'Document Graph Explorer.exe';
  const stagedExePath = path.join(downloadsDir, stagedExeName);
  cpSync(exePath, stagedExePath);
  console.log(`Staged run.exe -> ${path.relative(repoRoot, stagedExePath)}`);
} else {
  console.warn(`Skipped staging exe for download: ${path.relative(repoRoot, exePath)} not found`);
}
