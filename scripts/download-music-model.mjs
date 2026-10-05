import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const checksum = data => createHash('sha256').update(data).digest('hex');

// Upstream model hosts occasionally time out on clean CI/Docker builds.
// Retry transport/server failures (backing off up to 30s, about a minute
// of waiting in total), but never accept a mismatched model.
const ATTEMPTS = 6;
// Full-precision AST is 347 MB; 120 s only covers a sustained ~23 Mbps link.
const FETCH_TIMEOUT_MS = 600_000;
async function download(url, expectedHash) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let data;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === ATTEMPTS - 1) throw new Error(`Model download failed after ${ATTEMPTS} attempts: ${url}`, { cause: error });
      console.warn(`Model download attempt ${attempt + 1} failed; retrying ${url}`);
      await delay(Math.min(30_000, 2000 * 2 ** attempt));
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
