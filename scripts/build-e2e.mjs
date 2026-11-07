// Builds the app for the For you browser tests: the test-only no-inference boundary
// is ON (VITE_E2E_NO_INFERENCE=1) and no model-fetch hook runs. It calls
// `vite build` directly, never `npm run build` (whose prebuild fetches model packs),
// and only stages the local ffmpeg runtime copied out of node_modules.
import { spawnSync } from 'node:child_process';

const outDir = process.argv[2] ?? 'node_modules/.cache/dge-e2e-dist';
const env = { ...process.env, VITE_E2E_NO_INFERENCE: '1' };
delete env.DGE_MODELS;
for (const [cmd, args] of [
  [process.execPath, ['scripts/stage-audio-runtime.mjs']],
  [process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', outDir, '--emptyOutDir']],
]) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`E2E build written to ${outDir} (no-inference boundary ON; not for deployment).`);
