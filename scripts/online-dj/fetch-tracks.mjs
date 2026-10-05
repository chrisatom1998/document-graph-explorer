// Finds and downloads freely licensed DJ/electronic tracks for a real-world sound-tag check.
// Usage: node scripts/online-dj/fetch-tracks.mjs <audio-dir> <manifest.json>
// One track per genre, from ccMixter (rich instrument tags) with an Internet Archive
// netlabel fallback. Each track is cut to a 90 s WAV (the app analyses at most 90 s) excerpt starting at 60 s (past the
// intro). Audio stays in <audio-dir>; it is never committed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [audioDir, manifestPath] = process.argv.slice(2);
if (!audioDir || !manifestPath) throw new Error('Usage: node scripts/online-dj/fetch-tracks.mjs <audio-dir> <manifest.json>');
mkdirSync(audioDir, { recursive: true });

const GENRES = [
  ['house', ['house'], 'house'],
  ['techno', ['techno'], 'techno'],
  ['dnb', ['drum_n_bass', 'dnb'], 'drum and bass'],
  ['dubstep', ['dubstep'], 'dubstep'],
  ['trance', ['trance'], 'trance'],
  ['breakbeat', ['breakbeat', 'breaks'], 'breakbeat'],
  ['electro', ['electro'], 'electro'],
  ['triphop', ['trip_hop', 'downtempo'], 'trip hop'],
  ['hiphop', ['hip_hop'], 'hip hop'],
  ['disco', ['disco', 'nu_disco', 'funk'], 'disco'],
  ['ambient', ['ambient'], 'ambient'],
  ['trap', ['trap'], 'trap'],
];

const getJson = async url => {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'dge-sound-tag-check' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
};
const strip = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);

async function fromCcMixter(tags, used) {
  for (const tag of tags) {
    let rows;
    try { rows = await getJson(`https://ccmixter.org/api/query?f=json&tags=${encodeURIComponent(tag)}&limit=25&sort=rank`); }
    catch (e) { console.log(`ccMixter ${tag}: ${e.message}`); continue; }
    for (const row of rows ?? []) {
      const file = (row.files ?? []).find(f => /\.mp3$/i.test(f.download_url ?? '') || f.file_format_info?.['default-ext'] === 'mp3');
      const key = `cc:${row.upload_id}`;
      if (!file?.download_url || used.has(key)) continue;
      const seconds = Number(file.file_format_info?.ps?.split?.(':')?.reduce?.((a, b) => a * 60 + Number(b), 0)) || null;
      if (seconds !== null && seconds < 150) continue;
      used.add(key);
      return { source: 'ccMixter', url: file.download_url, page: row.file_page_url, title: row.upload_name, artist: row.user_name,
        license: row.license_name, sourceTags: String(row.upload_tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
        description: strip(row.upload_description_plain ?? row.upload_description) };
    }
  }
  return null;
}

async function fromArchive(tags, used) {
  for (const tag of tags) {
    const q = `collection:(netlabels) AND mediatype:(audio) AND subject:(${tag.replace(/_/g, ' ')}) AND licenseurl:(*creativecommons*)`;
    let docs;
    try { docs = (await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&rows=15&sort[]=downloads+desc&output=json`)).response.docs; }
    catch (e) { console.log(`archive ${tag}: ${e.message}`); continue; }
    for (const { identifier } of docs) {
      if (used.has(`ia:${identifier}`)) continue;
      let meta;
      try { meta = await getJson(`https://archive.org/metadata/${identifier}`); } catch { continue; }
      const file = meta.files?.find(f => /mp3/i.test(f.format ?? '') && Number(f.length) > 150);
      if (!file) continue;
      used.add(`ia:${identifier}`);
      const m = meta.metadata ?? {};
      return { source: 'Internet Archive', url: `https://archive.org/download/${identifier}/${encodeURIComponent(file.name)}`,
        page: `https://archive.org/details/${identifier}`, title: file.title ?? m.title, artist: file.creator ?? m.creator,
        license: m.licenseurl, sourceTags: [].concat(m.subject ?? []).flatMap(s => String(s).split(/[;,]/)).map(s => s.trim()).filter(Boolean),
        description: strip(m.description) };
    }
  }
  return null;
}

const used = new Set();
const items = [];
for (const [slug, tags, genre] of GENRES) {
  const track = await fromCcMixter(tags, used) ?? await fromArchive(tags, used);
  if (!track) { console.log(`no track found for ${genre}`); continue; }
  const id = `dj-${String(items.length + 1).padStart(2, '0')}-${slug}`;
  const mp3 = join(audioDir, `${id}.mp3`);
  try {
    const r = await fetch(track.url, { signal: AbortSignal.timeout(180_000), redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    writeFileSync(mp3, Buffer.from(await r.arrayBuffer()));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '60', '-t', '90', '-i', mp3, '-ac', '2', '-ar', '44100', join(audioDir, `${id}.wav`)]);
  } catch (e) { console.log(`download failed for ${genre}: ${e.message}`); continue; }
  items.push({ id, split: 'test', genre, ...track, excerpt: { startSeconds: 60, durationSeconds: 90 } });
  console.log(`${id}: "${track.title}" by ${track.artist} (${track.source}, ${track.license}) tags=[${track.sourceTags.join(', ')}]`);
}
writeFileSync(manifestPath, JSON.stringify({ items }, null, 1));
console.log(`${items.length} tracks ready`);
if (items.length < 6) process.exit(1);
