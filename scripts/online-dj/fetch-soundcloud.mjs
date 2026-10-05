// Finds Creative Commons DJ/electronic tracks on SoundCloud and cuts one short clip from each.
// Usage: node scripts/online-dj/fetch-soundcloud.mjs <audio-dir> <manifest.json> [clip-seconds=15]
// Needs yt-dlp and ffmpeg on PATH. Only tracks whose SoundCloud license is a Creative Commons
// one are used. The clip starts 35% into the track (past the intro). Audio is never committed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [audioDir, manifestPath, clipArg = '15'] = process.argv.slice(2);
if (!audioDir || !manifestPath) throw new Error('Usage: node scripts/online-dj/fetch-soundcloud.mjs <audio-dir> <manifest.json> [clip-seconds]');
const CLIP = Number(clipArg);
mkdirSync(audioDir, { recursive: true });

const GENRES = [
  ['house', 'deep house creative commons'], ['techno', 'techno creative commons'], ['dnb', 'drum and bass creative commons'],
  ['dubstep', 'dubstep creative commons'], ['trance', 'trance creative commons'], ['breakbeat', 'breakbeat creative commons'],
  ['electro', 'electro house creative commons'], ['triphop', 'trip hop creative commons'], ['hiphop', 'hip hop beat creative commons'],
  ['disco', 'nu disco creative commons'], ['ambient', 'ambient electronic creative commons'], ['trap', 'trap beat creative commons'],
  ['garage', 'uk garage creative commons'], ['lofi', 'lofi hip hop creative commons'],
];

const ytdlp = args => execFileSync('yt-dlp', args, { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 600_000 });
const used = new Set();
const items = [];
for (const [slug, query] of GENRES) {
  const isCc = t => /^cc-/.test(t.license ?? '') && t.duration > 60 && !used.has(t.id);
  let entries = [];
  for (const q of [query, query.replace('creative commons', 'free download')]) {
    let found;
    try {
      // Full metadata per hit, so the license and tags are known before anything is downloaded.
      found = ytdlp(['--dump-json', '--skip-download', '--ignore-errors', `scsearch25:${q}`]);
    } catch (e) { found = String(e.stdout ?? ''); }
    entries.push(...found.trim().split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }));
    if (entries.some(isCc)) break;
  }
  const track = entries.find(isCc);
  console.log(`${slug}: ${entries.length} hits, licenses ${JSON.stringify([...new Set(entries.map(t => t.license))])}`);
  if (!track) { console.log(`no Creative Commons track for ${slug}`); continue; }
  used.add(track.id);
  const id = `sc-${String(items.length + 1).padStart(2, '0')}-${slug}`;
  const start = Math.round(track.duration * 0.35);
  try {
    ytdlp(['-x', '--audio-format', 'mp3', '-o', join(audioDir, `${id}.full.%(ext)s`), track.webpage_url]);
    const full = readdirSync(audioDir).find(f => f.startsWith(`${id}.full.`));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-t', String(CLIP), '-i', join(audioDir, full), '-ac', '2', '-ar', '44100', join(audioDir, `${id}.wav`)]);
  } catch (e) { console.log(`download failed for ${slug}: ${String(e.message).slice(0, 200)}`); continue; }
  const strip = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  items.push({ id, split: 'test', genre: slug, source: 'SoundCloud', url: track.webpage_url, page: track.webpage_url, title: track.title,
    artist: track.uploader, license: track.license, sourceTags: [track.genre, ...(track.tags ?? [])].filter(Boolean),
    description: strip(track.description), excerpt: { startSeconds: start, durationSeconds: CLIP, trackSeconds: track.duration } });
  console.log(`${id}: "${track.title}" by ${track.uploader} (${track.license}) tags=[${items.at(-1).sourceTags.join(', ')}] clip ${start}-${start + CLIP}s`);
}
writeFileSync(manifestPath, JSON.stringify({ items }, null, 1));
console.log(`${items.length} SoundCloud clips ready`);
if (items.length < 6) process.exit(1);
