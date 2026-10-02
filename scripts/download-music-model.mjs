import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
for (const root of ['public/music-model', 'public/sound-model', 'public/jamendo-model']) {
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
for (const name of Object.keys(manifest.sha256).filter(name => name !== 'prompts.json')) {
  const path = join(root, name);
  try {
    const existing = await readFile(path);
    if (createHash('sha256').update(existing).digest('hex') === manifest.sha256[name]) continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(manifest.sources?.[name] ?? `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${name}`);
  if (!response.ok) throw new Error(`Music model download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== manifest.sha256[name]) throw new Error(`Music model checksum mismatch: ${name}`);
  await mkdir(dirname(path),{recursive:true});await writeFile(path,data);
}
}
