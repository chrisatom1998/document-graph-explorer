import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AUDIO_MODEL_ROOTS, AUDIO_PACK_MARKER, selectModelCapabilities } from './model-packs.mjs';

const checksum = data => createHash('sha256').update(data).digest('hex');
// The manifest host (essentia.upf.edu for the Jamendo embeddings) is the last
// resort. CI reads the same URL from DGE_MODEL_MIRROR. A GitHub Release asset
// name cannot contain a slash, so nested paths use '__'.
export const DEFAULT_MODEL_MIRROR =
  'https://github.com/chrisatom1998/document-graph-explorer/releases/download/models-v1';
const MIRROR_ATTEMPTS = 2;
const UPSTREAM_ATTEMPTS = 6;
// Full-precision AST is 347 MB; 120 s only covers a sustained ~23 Mbps link.
const FETCH_TIMEOUT_MS = 600_000;

export function audioModelSourceUrls(name, primary, env = process.env) {
  const configured = env.DGE_MODEL_MIRROR === undefined ? DEFAULT_MODEL_MIRROR : env.DGE_MODEL_MIRROR;
  const base = configured.trim().replace(/\/$/, '');
  const urls = [];
  if (base) urls.push(`${base}/${name.split('/').join('__')}`);
  if (!urls.includes(primary)) urls.push(primary);
  return urls;
}

function failover(message) {
  const error = new Error(message);
  error.failover = true;
  return error;
}

async function downloadUrl(url, expectedHash, attempts, fetchImpl, wait) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      // A missing mirror or a checksum miss will not start working on retry.
      if (response.status === 404 || response.status === 410) throw failover(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (checksum(data) !== expectedHash) throw failover(`Audio model checksum mismatch: ${url}`);
      return data;
    } catch (error) {
      if (error.failover || attempt === attempts - 1) throw error;
      console.warn(`Model download attempt ${attempt + 1} failed; retrying ${url}`);
      await wait(Math.min(30_000, 2000 * 2 ** attempt));
    }
  }
  throw new Error(`Model download failed: ${url}`);
}

export async function downloadVerified(urls, expectedHash, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const wait = options.wait ?? delay;
  const attemptsFor = options.attemptsFor ?? ((index, count) => index === count - 1 ? UPSTREAM_ATTEMPTS : MIRROR_ATTEMPTS);
  let lastError;
  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    try {
      console.log(`Downloading ${url}`);
      return await downloadUrl(url, expectedHash, attemptsFor(index, urls.length), fetchImpl, wait);
    } catch (error) {
      lastError = error;
      const final = index === urls.length - 1;
      console.warn(final
        ? `Model download failed: ${url}`
        : `Model source failed (${error.message}); trying next source after ${url}`);
      if (final) throw new Error(`Model download failed from ${urls.length} source(s): ${urls.join(', ')}`, { cause: error });
    }
  }
  throw lastError;
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
        name,
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
    // A restore-keys cache hit already has the bytes. Callers set this so a
    // prefix match is not a live fetch; a real gap still fails closed.
    if (process.env.DGE_MODEL_OFFLINE === '1') {
      throw new Error(`Audio model is missing or failed checksum, and live download is disabled: ${entry.path}`);
    }
    const data = await downloadVerified(audioModelSourceUrls(entry.name, entry.url), entry.hash);
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
