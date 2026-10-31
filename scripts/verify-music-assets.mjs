import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const outputRoot = process.argv[2] ?? 'public';
const requireAudio = process.argv.includes('--require-audio');

async function verifyDirectory(directory) {
  const root = join(outputRoot, directory);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  let packBytes = 0;
  for (const name of Object.keys(manifest.sha256)) {
    const data = await readFile(join(root, name));
    const hash = createHash('sha256').update(data).digest('hex');
    if (hash !== manifest.sha256[name]) throw new Error(`Model checksum mismatch: ${directory}/${name}`);
    // prompts.json is checked in and present in core-only artifacts; the pack
    // marker reports only the assets selected by the optional downloader.
    if (name !== 'prompts.json') packBytes += data.byteLength;
  }
  return packBytes;
}

await verifyDirectory('tempo-model');
let marker = null;
try { marker = JSON.parse(await readFile(join(outputRoot, 'audio-model-pack.json'), 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (requireAudio && !marker) throw new Error('The complete audio model pack is required for this build. Run npm run models:audio.');
if (marker) {
  let packBytes = 0;
  for (const directory of ['music-model', 'sound-model', 'jamendo-model', 'tagger-model']) packBytes += await verifyDirectory(directory);
  if (marker.schema !== 1 || marker.capability !== 'audio' || marker.bytes !== packBytes) {
    throw new Error(`Audio model pack marker does not match verified assets (${marker.bytes} != ${packBytes} bytes).`);
  }
  console.log(`Verified optional audio model pack (${marker.bytes} bytes), sound descriptions, and preprocessing configuration.`);
} else {
  console.log('Verified core runtime assets; optional audio model pack is not bundled.');
}
