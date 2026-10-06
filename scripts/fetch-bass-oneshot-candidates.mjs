/* Fetches CC0 Freesound previews as CANDIDATES for a new frozen bass-hit test set.
 * A candidate is not a label: the query that found it is only a hint, and a person reviews every clip before it is scored.
 * Skips every Freesound id and uploader that is in a reserved test split or in any training manifest,
 * and keeps at most MAX_PER_UPLOADER clips per uploader so the set is not one person's library.
 * Usage: FREESOUND_TOKEN=... node scripts/fetch-bass-oneshot-candidates.mjs <out-dir>
 * Writes <out-dir>/<id>.ogg and <out-dir>/index.json (id, uploader, licence, duration, query, hint). */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const OUT = process.argv[2];
const TOKEN = process.env.FREESOUND_TOKEN;
if (!OUT) { console.error('Usage: node scripts/fetch-bass-oneshot-candidates.mjs <out-dir>'); process.exit(2); }
if (!TOKEN) { console.error('Set FREESOUND_TOKEN. Get one free at https://freesound.org/apiv2/apply/'); process.exit(2); }

const PER_QUERY = Number(process.env.PER_QUERY || 40);
const MAX_PER_UPLOADER = Number(process.env.MAX_PER_UPLOADER || 2);
const EXTRAS = join(homedir(), 'Documents/Media/dj-training-fingerprints/extras');
const RESERVED = ['docs/evaluations/short-clips-2026-10-04/reserved-test-families.json', 'docs/evaluations/synth-clips-2026-10-05/reserved-test-families.json'];

// hint = what the query suggests, never a label. Negatives are the sounds a bass-hit head confuses with bass.
const QUERIES = [
  ['bass one shot', 'bass'], ['bass hit', 'bass'], ['sub bass hit', 'bass'], ['808 bass', 'bass'], ['bass stab', 'bass'],
  ['reese bass note', 'bass'], ['electric bass pluck', 'bass'], ['synth bass note', 'bass'],
  ['kick drum one shot', 'negative: kick'], ['impact hit', 'negative: impact'], ['synth stab', 'negative: synth'],
  ['cello pizzicato', 'negative: low strings'], ['tom drum hit', 'negative: drum'],
];

const skipIds = new Set(), skipUploaders = new Set();
for (const f of RESERVED) {
  if (!existsSync(f)) continue;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  (r.freesoundIds ?? []).forEach(i => skipIds.add(String(i)));
  (r.freesoundUploaders ?? []).forEach(u => skipUploaders.add(String(u).toLowerCase()));
}
for (const f of existsSync(EXTRAS) ? readdirSync(EXTRAS).filter(n => n.endsWith('.json')) : []) {
  let d; try { d = JSON.parse(readFileSync(join(EXTRAS, f), 'utf8')); } catch { continue; }
  for (const c of Array.isArray(d) ? d : d.clips ?? []) {
    const id = String(c.id ?? '').split(':').pop(); if (/^\d+$/.test(id)) skipIds.add(id);
    const up = String(c.group ?? '').split(':').pop().toLowerCase(); if (up) skipUploaders.add(up);
  }
}
console.log(`excluding ${skipIds.size} ids and ${skipUploaders.size} uploaders already used in training or reserved`);

const api = 'https://freesound.org/apiv2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { Authorization: `Token ${TOKEN}` } });
    if (r.ok) return r;
    if (r.status === 401 || r.status === 403) throw new Error(`${r.status}: token rejected`);
    if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
    if (i === tries - 1) throw new Error(`${r.status} ${url.slice(0, 90)}`);
    await sleep(1500 * (i + 1));
  }
}

mkdirSync(OUT, { recursive: true });
const INDEX = join(OUT, 'index.json');
const items = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')).items : [];
const have = new Set(items.map(i => String(i.id)));
const perUploader = {}; items.forEach(i => { perUploader[i.uploader.toLowerCase()] = (perUploader[i.uploader.toLowerCase()] || 0) + 1; });

for (const [query, hint] of QUERIES) {
  let got = items.filter(i => i.query === query).length;
  for (let page = 1; got < PER_QUERY && page <= 5; page++) {
    const url = `${api}/search/text/?query=${encodeURIComponent(query)}&fields=id,name,license,username,duration,previews`
      + `&filter=${encodeURIComponent('duration:[0.15 TO 2.0] license:"Creative Commons 0"')}&page_size=100&page=${page}`;
    let data; try { data = await (await get(url)).json(); } catch (e) { console.log(`  ${query}: ${String(e).slice(0, 70)}`); break; }
    if (!data.results?.length) break;
    for (const s of data.results) {
      const id = String(s.id), up = String(s.username).toLowerCase();
      if (got >= PER_QUERY) break;
      if (have.has(id) || skipIds.has(id) || skipUploaders.has(up) || (perUploader[up] || 0) >= MAX_PER_UPLOADER) continue;
      if (!/publicdomain\/zero|\/zero\//.test(s.license)) continue;
      const preview = s.previews?.['preview-hq-ogg']; if (!preview) continue;
      try {
        const r = await get(preview);
        await pipeline(Readable.fromWeb(r.body), createWriteStream(join(OUT, `${id}.ogg`)));
      } catch (e) { console.log(`  ${id}: download failed`); continue; }
      items.push({ id, uploader: s.username, license: s.license, duration: s.duration, name: s.name, query, hint });
      have.add(id); perUploader[up] = (perUploader[up] || 0) + 1; got++;
      await sleep(250);
    }
    writeFileSync(INDEX, JSON.stringify({ fetched: new Date().toISOString(), items }, null, 1));
  }
  console.log(`${query}: ${got}`);
}
console.log(`done: ${items.length} candidates in ${OUT}`);
