/* Downloads the bulk labelled-audio datasets that are not behind a rate-limited API.
 * Resumable: an interrupted file continues from where it stopped, and a finished one is skipped. */
import { mkdirSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const OUT = process.argv[2];
const ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;

const SETS = {
  // Effects as exact labels, with dry/wet pairs - the strongest match for the effect taxonomy.
  'idmt-smt-audio-effects': { record: 7544032, licence: 'CC BY-NC-ND 4.0',
    covers: 'distortion, overdrive, reverb, feedback/slapback delay, chorus, flanger, phaser, tremolo, vibrato, no-effect' },
  'egfxset': { record: 7044411, licence: 'CC BY 4.0',
    covers: '12 real hardware effects: distortion, overdrive, reverb (spring/hall/plate), delay, echo, chorus, flanger, phaser' },
  // Human-verified event labels: drums, whoosh, scratching, ambience.
  'fsd50k': { record: 4060432, licence: 'per-clip CC0/CC BY/CC BY-NC',
    covers: 'bass drum, snare, hi-hat, cymbals, whoosh, scratching, crowd/rain/wind/water ambience' },
};

// Zenodo serves a block page to clients with no real user agent.
const UA = { 'User-Agent': 'document-graph-explorer-dataset-fetch/1.0 (local research use)' };
async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: UA });
    const text = await r.text();
    if (r.ok && text.trimStart().startsWith('{')) return JSON.parse(text);
    if (i === tries - 1) throw new Error(`${r.status} not JSON from ${url}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    await new Promise(res => setTimeout(res, 4000 * (i + 1)));
  }
}
mkdirSync(OUT, { recursive: true });
for (const [name, meta] of Object.entries(SETS)) {
  if (ONLY && !ONLY.has(name)) continue;
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const record = await getJson(`https://zenodo.org/api/records/${meta.record}`);
  const files = record.files ?? [];
  const total = files.reduce((n, f) => n + f.size, 0);
  console.log(`\n${name}  ${(total / 1e9).toFixed(1)} GB in ${files.length} files  [${meta.licence}]`);
  console.log(`  covers: ${meta.covers}`);
  for (const f of files) {
    const target = join(dir, f.key);
    if (existsSync(target) && statSync(target).size === f.size) { console.log(`  have   ${f.key}`); continue; }
    const from = existsSync(target) ? statSync(target).size : 0;
    const url = f.links?.self ?? `https://zenodo.org/records/${meta.record}/files/${encodeURIComponent(f.key)}?download=1`;
    const started = Date.now();
    const response = await fetch(url, { headers: from ? { ...UA, Range: `bytes=${from}-` } : UA });
    if (!response.ok) { console.log(`  FAIL   ${f.key} ${response.status}`); continue; }
    // A server that ignores Range restarts the file rather than appending to it.
    const append = from > 0 && response.status === 206;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target, append ? { flags: 'a' } : {}));
    const mb = statSync(target).size / 1e6, secs = (Date.now() - started) / 1000;
    console.log(`  got    ${f.key.padEnd(36)} ${mb.toFixed(0)} MB in ${secs.toFixed(0)}s`);
  }
}
console.log('\ndone ->', OUT);
