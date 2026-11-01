import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assembleLearnedModel, isSplitLearnedIndex, type LearnedIndex } from './assembleLearnedModel';
import { sanitizeLearnedDjModel, type LearnedDjModel } from './learnedDjModel';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Check head-sha256.txt against the head files next to a split index. */
export function verifyLearnedIntegrity(root: string): void {
  const lines = readFileSync(join(root, 'head-sha256.txt'), 'utf8').trim().split('\n').filter(Boolean);
  const seen = new Set<string>();
  for (const line of lines) {
    const space = line.lastIndexOf(' ');
    const name = line.slice(0, space);
    const expected = line.slice(space + 1);
    if (!name || !/^[a-f0-9]{64}$/.test(expected) || seen.has(name)) throw new Error(`Bad learned-head integrity line: ${line}`);
    seen.add(name);
    const relative = name.startsWith('neighbour/') ? join('neighbours', `${name.slice('neighbour/'.length)}.json`) : join('heads', `${name}.json`);
    const actual = createHash('sha256').update(readFileSync(join(root, relative))).digest('hex');
    if (actual !== expected) throw new Error(`Learned head ${name} does not match head-sha256.txt`);
  }
}

/** Load a split index or a monolithic learned.json. Split files must match head-sha256.txt. */
export function readLearnedDocument(indexPath = 'public/sound-model/learned.json'): unknown {
  const raw = readJson(indexPath);
  if (!isSplitLearnedIndex(raw)) return raw;
  const root = dirname(indexPath);
  verifyLearnedIntegrity(root);
  const linear: Record<string, unknown> = {};
  for (const slug of raw.heads) linear[slug] = readJson(join(root, 'heads', `${slug}.json`));
  const neighbourFiles: Record<string, unknown> = {};
  const neighbours = (raw as LearnedIndex).neighbours;
  if (neighbours) {
    neighbourFiles[neighbours.background] = readJson(join(root, 'neighbours', `${neighbours.background}.json`));
    for (const slug of neighbours.heads) neighbourFiles[slug] = readJson(join(root, 'neighbours', `${slug}.json`));
  }
  return assembleLearnedModel(raw, linear, neighbourFiles);
}

export function readLearnedModel(indexPath = 'public/sound-model/learned.json'): LearnedDjModel | undefined {
  return sanitizeLearnedDjModel(readLearnedDocument(indexPath));
}
