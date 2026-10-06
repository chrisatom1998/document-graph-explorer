/** Computes the app's structure features (src/audio/structure.ts) for downloaded tracks with native FFmpeg decoding.
 * usage: vite-node scripts/structure-features.ts MANIFEST_JSON OUT_JSON
 * Output: { [key]: { duration, ms, blocks } }, blocks as base64 little-endian int16 of value*10, 8 values per block. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { StructureFeatures, STRUCTURE_RATE, STRUCTURE_FEATURES } from '../src/audio/structure';

const [manifestPath, outPath] = process.argv.slice(2);
const manifest: { key: string; file: string }[] = JSON.parse(readFileSync(manifestPath, 'utf8'));
const out: Record<string, { duration: number; ms: number; blocks: string }> = {};
for (const { key, file } of manifest) {
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(STRUCTURE_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (decoded.status !== 0) { console.log(key, 'decode failed'); continue; }
  const buf = decoded.stdout, pcm = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const t0 = performance.now(), f = new StructureFeatures();
  // The app reads 60 s at a time.
  for (let i = 0; i < pcm.length; i += 60 * STRUCTURE_RATE) f.add(pcm.slice(i, i + 60 * STRUCTURE_RATE));
  const ms = performance.now() - t0;
  const packed = new Int16Array(f.blocks.length * STRUCTURE_FEATURES.length);
  f.blocks.forEach((b, i) => b.forEach((v, j) => { packed[i * STRUCTURE_FEATURES.length + j] = Math.max(-32768, Math.min(32767, Math.round(v * 10))); }));
  out[key] = { duration: pcm.length / STRUCTURE_RATE, ms: Math.round(ms), blocks: Buffer.from(packed.buffer).toString('base64') };
  console.log(key, (pcm.length / STRUCTURE_RATE).toFixed(0), 's', ms.toFixed(0), 'ms');
}
writeFileSync(outPath, JSON.stringify(out));
