// Exercise publication and rollback with synthetic temporary files only.
// No private review corpus, model binaries, training, or network is required.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
  'run', 'src/dev/reviewFileTransaction.test.ts',
], { cwd: root, stdio: 'inherit' });
