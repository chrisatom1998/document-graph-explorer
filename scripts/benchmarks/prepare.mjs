// Freeze already-reviewed audio; never infer ground truth from a filename or model.
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertDisjoint, hash, manifestDigest, validateManifest } from './core.mjs';

export function prepare(inventoryPath, output, excludedPath) {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const root = dirname(resolve(inventoryPath));
  if (!Array.isArray(inventory.clips)) throw new Error('Inventory must contain clips');
  const sources = [];
  const clips = inventory.clips.map((clip, i) => {
    const source = realpathSync(resolve(root, clip.path));
    if (source === resolve(output) || relative(resolve(output), source).split('/')[0] !== '..' && !isAbsolute(relative(resolve(output), source))) {
      throw new Error('Source audio must be outside the new output directory');
    }
    const extension = extname(source).toLowerCase();
    const bytes = readFileSync(source);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', source], { encoding: 'utf8', timeout: 30_000 }));
    const file = `c${String(i).padStart(6, '0')}${extension}`;
    sources.push({ source, file });
    return { id: clip.id, file, sha256: hash(bytes), group: clip.group, split: clip.split,
      kind: clip.kind, seconds: Number(probe.format?.duration), truth: clip.truth, provenance: clip.provenance };
  });
  const manifest = validateManifest({ version: 1, labels: inventory.labels, clips });
  if (excludedPath) assertDisjoint(manifest, validateManifest(JSON.parse(readFileSync(excludedPath, 'utf8'))));
  if (existsSync(output)) throw new Error('Output already exists; use a new directory so a frozen benchmark cannot be overwritten');
  mkdirSync(join(output, 'audio'), { recursive: true });
  for (const { source, file } of sources) copyFileSync(source, join(output, 'audio', file));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(join(output, 'manifest.sha256'), manifestDigest(manifest) + '\n', { flag: 'wx' });
  console.log(`Frozen ${clips.length} clips. Manifest SHA-256: ${manifestDigest(manifest)}`);
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [inventory, output, excluded] = process.argv.slice(2);
  if (!inventory || !output) throw new Error('Usage: node scripts/benchmarks/prepare.mjs <reviewed-inventory.json> <new-output-dir> [training-manifest.json]');
  prepare(inventory, output, excluded);
}
