// Copies dist/ next to the packaged run.exe under release/win/. The exe
// serves the dist folder that sits beside it (see serve-exe.cjs APP_BASE),
// so this makes release/win/ a self-contained folder you can zip and ship:
//   release/win/run.exe  + release/win/dist/
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const distDir = path.join(repoRoot, 'dist');
const stagedDist = path.join(repoRoot, 'release', 'win', 'dist');

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/ build not found - run: npm run build');
  process.exit(1);
}

rmSync(stagedDist, { recursive: true, force: true });
cpSync(distDir, stagedDist, { recursive: true });
console.log(`Staged dist/ -> ${path.relative(repoRoot, stagedDist)}`);
