/* Versions test set: real remix groups (fetch-ccmixter-remixes.py) plus re-encoded, trimmed,
 * edited, pitch- and tempo-shifted copies of some of those remixes and of the melodic loops.
 * Every file gets a `recording` (same audio, maybe transformed) and a `song` (same song, any
 * recording); a pair is a duplicate when the recordings match and a remix when only the songs do.
 * Copies get neutral names so the audio has to find them; real remix file names are kept.
 * Usage: node build-versions-test-set.mjs <ccmixter_dir> <loops_dir> <out_dir> */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const [CCM, LOOPS, OUT] = process.argv.slice(2);
mkdirSync(join(OUT, 'copies'), { recursive: true });
const duration = path => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' }).stdout.trim());
const ffmpeg = (args) => { const r = spawnSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr.slice(0, 200)); };

const files = [];
const { groups } = JSON.parse(readFileSync(join(CCM, 'remixes.json'), 'utf8'));
for (const g of groups) for (const r of g.remixes) files.push({ id: r.id, path: r.path, name: r.file, recording: r.id, song: `ccm-song-${g.source}`, origin: 'ccmixter remix', license: r.license, page: r.page });
for (const name of readdirSync(LOOPS).filter(n => n.endsWith('.wav')).sort()) {
  const id = `loop-${basename(name, '.wav').replace(/^SHADOW_UK1_Melodic_Loop_/, '')}`;
  files.push({ id, path: join(LOOPS, name), name, recording: id, song: id, origin: 'melodic loop' });
}
for (const f of files) f.duration = duration(f.path);

/** Same recording, changed the ways files really get changed. */
const TRANSFORMS = [
  { id: 'mp3-128', ext: 'mp3', args: () => ['-c:a', 'libmp3lame', '-b:a', '128k'] },
  { id: 'aac-quieter', ext: 'm4a', args: () => ['-af', 'volume=-5dB', '-c:a', 'aac', '-b:a', '96k'] },
  { id: 'trim', ext: 'mp3', pre: d => ['-ss', (d * .1).toFixed(2), '-t', (d * .75).toFixed(2)], args: () => ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  { id: 'edit', ext: 'mp3', args: d => ['-filter_complex', `[0:a]atrim=0:${(d * .35).toFixed(2)},asetpts=PTS-STARTPTS[a];[0:a]atrim=${(d * .55).toFixed(2)},asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1`, '-c:a', 'libmp3lame', '-b:a', '192k'] },
  { id: 'pitch+2', ext: 'mp3', args: () => ['-af', 'rubberband=pitch=1.122462', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  { id: 'tempo+5', ext: 'mp3', args: () => ['-af', 'rubberband=tempo=1.05', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  { id: 'varispeed-6', ext: 'mp3', args: () => ['-af', 'asetrate=44100*0.94,aresample=44100', '-c:a', 'libmp3lame', '-b:a', '192k'] },
  { id: 'dj-pitch-1-tempo-3', ext: 'mp3', args: () => ['-af', 'rubberband=pitch=0.943874:tempo=0.97', '-c:a', 'libmp3lame', '-b:a', '192k'] },
];
// Copies of the first two remixes of every group and of every loop.
const perGroup = new Map();
const sources = files.filter(f => f.origin === 'melodic loop' || (perGroup.set(f.song, (perGroup.get(f.song) ?? 0) + 1), perGroup.get(f.song) <= 2));
let n = 0;
const copies = [];
for (const f of sources) for (const t of TRANSFORMS) {
  const name = `copy-${String(++n).padStart(3, '0')}.${t.ext}`;
  const path = join(OUT, 'copies', name);
  if (!existsSync(path)) ffmpeg([...(t.pre?.(f.duration) ?? []), '-i', f.path, '-ac', '2', '-ar', '44100', ...t.args(f.duration), path]);
  copies.push({ id: `${f.id}~${t.id}`, path, name, recording: f.recording, song: f.song, origin: `copy: ${t.id}`, duration: duration(path) });
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ files: [...files, ...copies] }, null, 1));
console.log(`${files.length} originals (${groups.length} remix groups), ${copies.length} copies`);
