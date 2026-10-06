import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
for (const directory of ['music-model', 'sound-model', 'jamendo-model', 'tempo-model']) {
const root = join(process.argv[2] ?? 'public', directory);
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
for (const name of Object.keys(manifest.sha256)) {
  const hash = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
  if (hash !== manifest.sha256[name]) throw new Error(`Music model checksum mismatch: ${name}`);
}
}
console.log('Verified bundled instrument models, the tempo model, sound descriptions, and preprocessing configuration.');
