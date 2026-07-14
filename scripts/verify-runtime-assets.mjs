/**
 * Catch a broken packaged inference runtime before it reaches a release.
 * Vite fingerprints ONNX Runtime's WebAssembly files, so checking for a
 * concrete filename is deliberately avoided.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

// Tesseract is configured to use only these same-origin files. Check every
// runtime variant its v7 feature detection can select, plus the English model,
// so an incomplete public/ copy cannot ship as an OCR feature that fails only
// on a particular browser/CPU.
const ocrDir = join(outputDir, 'ocr');
const requiredOcrAssets = [
  'worker.min.js',
  join('core', 'tesseract-core-lstm.wasm.js'),
  join('core', 'tesseract-core-simd-lstm.wasm.js'),
  join('core', 'tesseract-core-relaxedsimd-lstm.wasm.js'),
  join('lang', 'eng.traineddata.gz'),
];
for (const relativePath of requiredOcrAssets) {
  const asset = join(ocrDir, relativePath);
  if (!existsSync(asset) || statSync(asset).size === 0) {
    throw new Error(`Missing or empty bundled OCR runtime asset: ${asset}`);
  }
}
const languageHeader = readFileSync(join(ocrDir, 'lang', 'eng.traineddata.gz')).subarray(0, 2);
if (!languageHeader.equals(Buffer.from([0x1f, 0x8b]))) {
  throw new Error(`Invalid gzip OCR language asset in ${ocrDir}`);
}

console.log(
  `Verified ${wasmAssets.length} WebAssembly runtime asset(s), bundled embedding model, and same-origin OCR runtime in ${outputDir}.`,
);
