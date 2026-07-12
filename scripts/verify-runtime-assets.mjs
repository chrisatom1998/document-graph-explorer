/**
 * Catch a broken packaged inference runtime before it reaches a release.
 * Vite fingerprints ONNX Runtime's WebAssembly files, so checking for a
 * concrete filename is deliberately avoided.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const outputDir = process.argv[2];
if (!outputDir) throw new Error('Usage: node scripts/verify-runtime-assets.mjs <dist-directory>');
const assetsDir = join(outputDir, 'assets');
if (!existsSync(assetsDir)) throw new Error(`Missing assets directory: ${assetsDir}`);
const wasmAssets = readdirSync(assetsDir).filter((file) => file.endsWith('.wasm'));
if (wasmAssets.length === 0) throw new Error(`No WebAssembly runtime assets found in ${assetsDir}`);
for (const asset of wasmAssets) {
  const header = readFileSync(join(assetsDir, asset)).subarray(0, 4);
  if (!header.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) throw new Error(`Invalid WebAssembly asset: ${asset}`);
}
const modelDir = join(outputDir, 'models');
function hasOnnx(dir) {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isFile() ? entry.name.endsWith('.onnx') : entry.isDirectory() && hasOnnx(join(dir, entry.name)),
  );
}
if (!existsSync(modelDir) || !hasOnnx(modelDir)) {
  throw new Error(`No bundled ONNX embedding model found in ${modelDir}`);
}
console.log(`Verified ${wasmAssets.length} WebAssembly runtime asset(s) and bundled embedding model in ${outputDir}.`);
