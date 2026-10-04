/* Downloads Freesound previews for the DJ sound labels, grouped into one folder per label.
 * Needs a free Freesound API token: https://freesound.org/apiv2/apply/
 * Pass it as FREESOUND_TOKEN. Records each sound's own licence next to the audio, because
 * the per-file licence - not the dataset licence - governs what a trained model may be used for. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const COVERAGE = process.argv[2];
const OUT = process.argv[3];
const TOKEN = process.env.FREESOUND_TOKEN;
const PER_LABEL = Number(process.env.PER_LABEL || 200);
const MIN_MATCHES = Number(process.env.MIN_MATCHES || 300);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(s => s.trim())) : null;
if (!TOKEN) { console.error('Set FREESOUND_TOKEN. Get one free at https://freesound.org/apiv2/apply/'); process.exit(2); }

const api = 'https://freesound.org/apiv2';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { Authorization: `Token ${TOKEN}` } });
    if (r.ok) return r;
    if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }   // documented rate limit
    if (i === tries - 1) throw new Error(`${r.status} ${url.slice(0, 90)}`);
    await sleep(1500 * (i + 1));
  }
}

const coverage = JSON.parse(readFileSync(COVERAGE, 'utf8'));
const wanted = coverage.rows
  .filter(r => r.tagOrTitleMatches >= MIN_MATCHES)
  .filter(r => !ONLY || ONLY.has(r.label));
console.log(`labels to fetch: ${wanted.length} (at least ${MIN_MATCHES} matches each), up to ${PER_LABEL} sounds per label`);
mkdirSync(OUT, { recursive: true });

const INDEX = join(OUT, 'index.json');
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')).items : [];
for (const row of wanted) {
  const dir = join(OUT, row.label.replace(/[^a-z0-9]+/gi, '-'));
  mkdirSync(dir, { recursive: true });
  // Freesound's parser treats quoted OR as AND, so each term is searched on its own.
  let fetched = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.ogg')).length : 0;
  const seen = new Set(readdirSync(dir).map(f => f.replace('.ogg', '')));
  for (const term of row.terms) {
    for (let page = 1; fetched < PER_LABEL && page <= 6; page++) {
      const url = `${api}/search/text/?query=${encodeURIComponent(term)}`
        + `&fields=id,name,tags,license,username,duration,previews,url`
        + `&filter=duration:[0.3 TO 30]&page_size=150&page=${page}`;
      let data;
      try { data = await (await get(url)).json(); }
      catch (e) { if (!String(e).includes('404')) console.log(`  ${row.label}/${term}: search failed ${String(e).slice(0, 60)}`); break; }
      if (!data.results?.length) break;
      for (const s of data.results) {
        if (fetched >= PER_LABEL) break;
        if (seen.has(String(s.id))) continue;
        const preview = s.previews?.['preview-hq-ogg'] ?? s.previews?.['preview-lq-ogg'];
        if (!preview) continue;
        const file = join(dir, `${s.id}.ogg`);
        try {
          const r = await get(preview);
          await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
        } catch (e) { console.log(`  skip ${s.id}: ${String(e).slice(0, 60)}`); continue; }
        await sleep(120);
        seen.add(String(s.id));
        index.push({ label: row.label, group: row.group, id: s.id, file, term,
          name: s.name, tags: s.tags, license: s.license, username: s.username,
          duration: s.duration, page: s.url });
        fetched++;
      }
      if (!data.next) break;
    }
    if (fetched >= PER_LABEL) break;
  }
  console.log(`${row.label.padEnd(22)} ${String(fetched).padStart(4)} sounds -> ${dir}`);
  writeFileSync(INDEX, JSON.stringify({ kind: 'freesound-dj-samples-v1', fetchedAt: new Date().toISOString(), items: index }, null, 1));
}

const byLicence = {};
for (const i of index) byLicence[i.license] = (byLicence[i.license] ?? 0) + 1;
console.log(`\ntotal sounds: ${index.length} across ${wanted.length} labels`);
console.log('licences:'); for (const [l, n] of Object.entries(byLicence).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(5)}  ${l}`);
console.log(`\nindex: ${join(OUT, 'index.json')}`);
