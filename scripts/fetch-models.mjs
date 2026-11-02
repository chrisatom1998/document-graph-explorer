import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AUDIO_MODEL_ROOTS, AUDIO_PACK_MARKER, selectModelCapabilities } from './model-packs.mjs';

const checksum = data => createHash('sha256').update(data).digest('hex');
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
    if (checksum(data) !== expectedHash) throw new Error(`Audio model checksum mismatch: ${url}`);
    return data;
  }
}

async function audioManifestEntries() {
  const entries = [];
  const manifests = [];
  for (const root of AUDIO_MODEL_ROOTS) {
    const manifestText = await readFile(join(root, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    manifests.push(manifestText);
    for (const name of Object.keys(manifest.sha256).filter(name => name !== 'prompts.json')) {
      entries.push({
        path: join(root, name),
        url: manifest.sources?.[name] ?? `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${name}`,
        hash: manifest.sha256[name],
      });
    }
  }
  return { entries, revision: checksum(manifests.join('\n')) };
}

async function verifiedAudioPack(downloadMissing) {
  const { entries, revision } = await audioManifestEntries();
  let bytes = 0;
  for (const entry of entries) {
    let valid = false;
    try {
      const data = await readFile(entry.path);
      valid = checksum(data) === entry.hash;
      if (valid) bytes += data.byteLength;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (valid) continue;
    if (!downloadMissing) return null;
    const data = await download(entry.url, entry.hash);
    await mkdir(dirname(entry.path), { recursive: true });
    await writeFile(entry.path, data);
    bytes += data.byteLength;
  }
  return { schema: 1, capability: 'audio', revision, bytes, files: entries.length };
}

async function markerMatchesCurrentPack() {
  try {
    const marker = JSON.parse(await readFile(AUDIO_PACK_MARKER, 'utf8'));
    const { revision } = await audioManifestEntries();
    return marker?.schema === 1 && marker.capability === 'audio' && marker.revision === revision &&
      Number.isSafeInteger(marker.bytes) && marker.bytes > 0 && (await stat(AUDIO_PACK_MARKER)).size > 0;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function writeAudioPackMarker(pack) {
  await writeFile(AUDIO_PACK_MARKER, `${JSON.stringify(pack, null, 2)}\n`);
}

export async function fetchModelPacks(value = process.env.DGE_MODELS) {
  const selection = selectModelCapabilities(value);
  if (selection.core) {
    console.log('Core model pack is bundled with the repository; no download needed.');
  }
  if (selection.audio) {
    const pack = await verifiedAudioPack(true);
    await writeAudioPackMarker(pack);
    console.log(`Audio model pack verified (${pack.bytes} bytes).`);
    return selection;
  }

  // A restored CI/developer cache may predate the marker. Recover it without
  // downloading anything, while clean document-only builds avoid hashing the
  // large optional pack on every run.
  if (!(await markerMatchesCurrentPack())) {
    const installed = await verifiedAudioPack(false);
    if (installed) await writeAudioPackMarker(installed);
  }
  return selection;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await fetchModelPacks(process.argv[2] ?? process.env.DGE_MODELS);
}
