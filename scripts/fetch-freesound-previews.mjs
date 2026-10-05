/* Downloads public Freesound preview MP3s (no API token) for a freesound-mine-manifest.py list.
 * Reads each sound's public page once to find its preview URL and its own Creative Commons licence,
 * then fetches only the first ~15 s of the high-quality preview (the CLAP fingerprint reads 10 s).
 * Writes <dir>/audio/<id>.mp3 and <dir>/manifest.json (clips that downloaded, with licence + author
 * for attribution). Resumable; polite: CONCURRENCY (3) requests at a time with retry/backoff.
 * Usage: fetch-freesound-previews.mjs <candidates.json> <dir> */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [CANDS, DIR] = process.argv.slice(2);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const BYTES = 250000;   // ~15 s of a 128 kb/s preview
mkdirSync(join(DIR, 'audio'), { recursive: true });
const cands = JSON.parse(readFileSync(CANDS, 'utf8')).clips;
const STATE = join(DIR, 'state.json');
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0 (DGE research; non-commercial label training)' };

async function get(url, init = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } });
      if (r.ok || r.status === 206) return r;
      if (r.status === 404 || r.status === 410) return r;
      await sleep((r.status === 429 ? 8000 : 1500) * (i + 1));
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

let done = 0, ok = 0, gone = 0;
async function one(c) {
  const key = String(c.freesoundId);
  const file = join(DIR, 'audio', `${key}.mp3`);
  if (state[key]?.status === 'ok' && existsSync(file)) { ok++; return; }
  if (state[key]?.status === 'gone') { gone++; return; }
  const page = await get(`https://freesound.org/people/${encodeURIComponent(c.username)}/sounds/${key}/`);
  if (!page || !page.ok) { state[key] = { status: page ? 'gone' : 'error' }; if (page) gone++; return; }
  const html = await page.text();
  const preview = html.match(/https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-hq\.mp3/)?.[0];
  const licence = html.match(/https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[a-z\-+]+\/[\d.]+\/?/i)?.[0] ?? null;
  if (!preview) { state[key] = { status: 'gone' }; gone++; return; }
  const audio = await get(preview, { headers: { Range: `bytes=0-${BYTES}` } });
  if (!audio || !(audio.ok || audio.status === 206)) { state[key] = { status: 'error' }; return; }
  writeFileSync(file, Buffer.from(await audio.arrayBuffer()));
  state[key] = { status: 'ok', licence, preview };
  ok++;
}

const queue = [...cands];
const started = Date.now();
async function worker() {
  while (queue.length) {
    const c = queue.shift();
    await one(c); done++;
    if (done % 100 === 0) {
      writeFileSync(STATE, JSON.stringify(state));
      console.log(`${done}/${cands.length}  ok ${ok}  gone ${gone}  ${((Date.now() - started) / done).toFixed(0)} ms/clip`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(STATE, JSON.stringify(state));
const clips = cands.filter(c => state[String(c.freesoundId)]?.status === 'ok' && existsSync(join(DIR, 'audio', `${c.freesoundId}.mp3`)) && statSync(join(DIR, 'audio', `${c.freesoundId}.mp3`)).size > 8000)
  .map(c => ({ ...c, path: join(DIR, 'audio', `${c.freesoundId}.mp3`), licence: state[String(c.freesoundId)].licence, author: c.username,
    url: `https://freesound.org/people/${c.username}/sounds/${c.freesoundId}/` }));
writeFileSync(join(DIR, 'manifest.json'), JSON.stringify({ kind: 'freesound-mined-audio-v1', clips }, null, 1));
console.log(`done: ${clips.length} clips with audio, ${gone} gone`);
