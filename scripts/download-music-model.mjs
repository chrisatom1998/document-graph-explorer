import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const checksum = data => createHash('sha256').update(data).digest('hex');

// Upstream model hosts occasionally time out on clean CI/Docker builds.
// Retry transport/server failures, but never accept a mismatched model.
async function download(url, expectedHash) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let data;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw new Error(`Model download failed after four attempts: ${url}`, { cause: error });
      console.warn(`Model download attempt ${attempt + 1} failed; retrying ${url}`);
      await delay(1000 * 2 ** attempt);
      continue;
    }
    if (checksum(data) !== expectedHash) throw new Error(`Music model checksum mismatch: ${url}`);
    return data;
  }
}

for (const root of ['public/music-model', 'public/sound-model', 'public/jamendo-model']) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  for (const name of Object.keys(manifest.sha256).filter(name => name !== 'prompts.json')) {
    const path = join(root, name);
    try {
      if (checksum(await readFile(path)) === manifest.sha256[name]) continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const url = manifest.sources?.[name] ?? `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${name}`;
    const data = await download(url, manifest.sha256[name]);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
}

// Optional large weights: a missing source or failed download leaves the feature off, never the build.
for (const root of ['public/passt-model']) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  for (const name of Object.keys(manifest.sha256)) {
    const path = join(root, name);
    try {
      if (checksum(await readFile(path)) === manifest.sha256[name]) continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const url = manifest.sources?.[name];
    if (!url) { console.warn(`Optional model ${root}/${name} has no download source; skipped.`); continue; }
    try {
      const data = await download(url, manifest.sha256[name]);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    } catch (error) { console.warn(`Optional model ${root}/${name} unavailable; skipped. ${error.message}`); }
  }
}
