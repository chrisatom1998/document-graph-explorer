// Inputs are explicitly licensed sources. Short crops receive their own truth, never inherited truth.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { digest } from './core.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/research/prepare.mjs inventory.json new-output-directory');
if (existsSync(output)) throw new Error('Refusing to overwrite an experiment');
const inventory = JSON.parse(readFileSync(input, 'utf8'));
const clips = [], root = dirname(resolve(input));
mkdirSync(join(output, 'audio'), { recursive: true });
for (const source of inventory.sources) {
  if (!source.rights?.evaluationAllowed || !source.rights.basis || !source.provenance) throw new Error(`Missing rights/provenance: ${source.id}`);
  const path = resolve(root, source.path);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { encoding: 'utf8' }));
  for (const seconds of inventory.durations ?? [1, 2, 6, 10]) {
    const start = source.start ?? 0;
    if (start + seconds > Number(info.format.duration) + .005) continue;
    const id = `${source.id}-${seconds}s`, file = `audio/c${String(clips.length).padStart(6, '0')}.wav`;
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(start), '-i', path, '-t', String(seconds), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', join(output, file)]);
    const truth = source.truthByDuration?.[String(seconds)] ?? {};
    clips.push({ id, path: file, sha256: digest(readFileSync(join(output, file))), group: source.group,
      split: source.split ?? 'development', seconds, provenance: source.provenance, rights: source.rights,
      sourceStart: start, truth, ...(truth.binding ? { binding: truth.binding } : {}),
      referenceKind: source.referenceKind ?? 'published-annotation' });
  }
}
if (!clips.length) throw new Error('No source was long enough');
const manifest = { version: 'dge-research-v1', createdAt: new Date().toISOString(),
  note: 'Pilot only. Missing truth is unknown. Duration crops are grouped by original source.', clips };
const bytes = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(join(output, 'manifest.json'), bytes, { flag: 'wx' });
writeFileSync(join(output, 'manifest.sha256'), digest(bytes) + '\n', { flag: 'wx' });
console.log(`Prepared ${clips.length} crops; ${clips.filter(c => Object.keys(c.truth).length).length} have explicit truth.`);
