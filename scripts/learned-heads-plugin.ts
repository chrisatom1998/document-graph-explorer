import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL = 'virtual:learned-heads';
const RESOLVED = '\0virtual:learned-heads';

function listJson(dir: string): string[] {
  try {
    return readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

/** One module containing every learned head, plus the build-time integrity stamp.
 * Head files stay separate in git. The browser loads this module in a single request. */
export function learnedHeadsPlugin(root = process.cwd()): Plugin {
  const headsDir = join(root, 'public/sound-model/heads');
  const neighboursDir = join(root, 'public/sound-model/neighbours');
  const integrityPath = join(root, 'public/sound-model/head-sha256.txt');
  const object = (dir: string, names: string[]) => names.map(name => {
    const json = readFileSync(join(dir, name), 'utf8').trim();
    return `${JSON.stringify(name.replace(/\.json$/, ''))}: ${json}`;
  }).join(',');
  return {
    name: 'document-graph-explorer:learned-heads',
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
      return undefined;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      this.addWatchFile(integrityPath);
      const linear = listJson(headsDir);
      const neighbours = listJson(neighboursDir);
      for (const name of linear) this.addWatchFile(join(headsDir, name));
      for (const name of neighbours) this.addWatchFile(join(neighboursDir, name));
      return `export const linear = {${object(headsDir, linear)}};\nexport const neighbours = {${object(neighboursDir, neighbours)}};\n`;
    },
    transform(_code, id) {
      const normalized = id.split('\\').join('/');
      if (!normalized.endsWith('/src/audio/learnedIntegrity.ts')) return null;
      this.addWatchFile(integrityPath);
      const digest = createHash('sha256').update(readFileSync(integrityPath)).digest('hex').slice(0, 16);
      return `export const learnedHeadsStamp = ${JSON.stringify(digest)};\n`;
    },
  };
}
