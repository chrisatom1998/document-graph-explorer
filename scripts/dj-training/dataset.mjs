import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const LABELS = ['source:voice', 'source:synthesizer', 'production:vocal breath', 'production:vocal chops'];

// Deliberately pack-specific. "Melodic" means synth here because the owner
// confirmed it; it is not a safe labeling rule for arbitrary sample libraries.
export function shadowLabels(path) {
  // CHOP describes editing, not a human voice. A Vocal folder is not enough
  // to contradict the owner's correction or to supply a source for a chop.
  if (/_CHOP[ _]\d/i.test(path)) return {
    targets: {}, provenance: 'Generic chop; source and vocal subtype unreviewed. Excluded from source/vocal training.',
  };
  if (path.startsWith('Vocal/') && !/_Vocal_|\bVOX\b/i.test(path)) return {
    targets: {}, provenance: 'Folder alone does not confirm voice; source needs review.',
  };
  if (path.startsWith('Melodic/')) return {
    targets: Object.fromEntries(LABELS.map(label => [label, Number(label === 'source:synthesizer')])),
    provenance: 'Owner confirmed these melodic samples are synthesizers',
  };
  if (path.startsWith('Vocal/')) {
    const targets = { 'source:voice': 1 };
    const breath = /_Vocal_Breath/i.test(path);
    if (breath) {
      targets['source:synthesizer'] = 0;
      targets['production:vocal breath'] = Number(breath);
      targets['production:vocal chops'] = 0;
    }
    return { targets, provenance: breath ? 'Explicit filename tag; source from Vocal folder' : 'Vocal folder only; production type unreviewed' };
  }
  return { targets: {}, provenance: 'No confirmed label; excluded from training' };
}

export function sampleFamily(path) {
  // Keep numbered takes and all CHOP variants together during validation.
  return path.toLowerCase().replace(/\.wav$/, '').replace(/\d+/g, '').replace(/[ _-]+/g, ' ').trim();
}

export async function inventory(root) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.wav$/i.test(entry.name)) {
        const bytes = await readFile(path);
        const name = relative(root, path).split('\\').join('/');
        const wave = ['RIFF', 'RF64', 'RIFX'].includes(bytes.toString('ascii', 0, 4)) && bytes.toString('ascii', 8, 12) === 'WAVE';
        files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
          family: sampleFamily(name), ...shadowLabels(name),
          ...(wave ? {} : { excluded: 'Not a WAV audio payload (likely Finder metadata)' }),
        });
      }
    }
  }
  await visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function groupDuplicates(rows, threshold = 0.98) {
  const parent = rows.map((_, i) => i);
  function find(i) { while (parent[i] !== i) i = parent[i]; return i; }
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < i; j++) {
    const similar = rows[i].vector && rows[j].vector && rows[i].vector.reduce((s, v, k) => s + v * rows[j].vector[k], 0) >= threshold;
    if (rows[i].family === rows[j].family || rows[i].sha256 === rows[j].sha256 || similar) parent[find(i)] = find(j);
  }
  return rows.map((row, i) => ({ ...row, family: rows[find(i)].family }));
}
