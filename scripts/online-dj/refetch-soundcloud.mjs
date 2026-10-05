// Re-downloads the frozen SoundCloud clip list so different app versions see identical audio.
// Usage: node scripts/online-dj/refetch-soundcloud.mjs <audio-dir> <manifest.json>
// Needs yt-dlp and ffmpeg. Reads scripts/online-dj/soundcloud-clips.json; audio is never committed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [audioDir, manifestPath] = process.argv.slice(2);
if (!audioDir || !manifestPath) throw new Error('Usage: node scripts/online-dj/refetch-soundcloud.mjs <audio-dir> <manifest.json>');
const frozen = JSON.parse(readFileSync(new URL('./soundcloud-clips.json', import.meta.url), 'utf8'));
mkdirSync(audioDir, { recursive: true });
const items = [];
for (const clip of frozen.items) {
  try {
    execFileSync('yt-dlp', ['--no-warnings', '--sleep-requests', '2', '-x', '--audio-format', 'mp3', '-o', join(audioDir, `${clip.id}.full.%(ext)s`), clip.url], { stdio: 'ignore', timeout: 600_000 });
    const full = readdirSync(audioDir).find(f => f.startsWith(`${clip.id}.full.`));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(clip.startSeconds), '-t', String(frozen.clipSeconds), '-i', join(audioDir, full), '-ac', '2', '-ar', '44100', join(audioDir, `${clip.id}.wav`)]);
  } catch (e) { console.log(`download failed for ${clip.id}: ${String(e.message).slice(0, 200)}`); continue; }
  items.push({ ...clip, split: 'test', source: 'SoundCloud', page: clip.url, excerpt: { startSeconds: clip.startSeconds, durationSeconds: frozen.clipSeconds } });
  console.log(`${clip.id} ready`);
}
writeFileSync(manifestPath, JSON.stringify({ items }, null, 1));
console.log(`${items.length}/${frozen.items.length} clips ready`);
if (items.length < frozen.items.length - 2) process.exit(1);
