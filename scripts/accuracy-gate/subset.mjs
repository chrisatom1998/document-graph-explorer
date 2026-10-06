// Write the manifests the accuracy gate analyses and scores, from the frozen round 3 held-out set.
// Usage: node scripts/accuracy-gate/subset.mjs <fast|full> <out-dir>
// Writes jamendo.json (weak view: uploader tags present, untagged = weak absent), jamendo-strict.json (only real labels)
// and mtgkey.json (tempo and key) into <out-dir>.
//
// fast: a fixed 150-track slice of the 500 Jamendo tracks plus all 318 MTG key tracks. The slice depends only on the
//   manifest's labels and ids (which are hashes), never on model output: classes are visited rarest first and tracks
//   are taken in id order until each class has min(30, all) positives, then the slice is filled to 150 in id order.
// full: every track of both sets.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [mode, outDir] = process.argv.slice(2);
if (!['fast', 'full'].includes(mode) || !outDir) throw new Error('Usage: node scripts/accuracy-gate/subset.mjs <fast|full> <out-dir>');
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'evaluations', 'holdout-r3-2026-10-06');
const jamendo = JSON.parse(readFileSync(join(DOCS, 'jamendo-manifest.json'), 'utf8'));
const mtgkey = JSON.parse(readFileSync(join(DOCS, 'mtg-key-manifest.json'), 'utf8'));
export const FAST_SIZE = 150, FAST_PER_CLASS = 30;

let items = jamendo.items;
if (mode === 'fast') {
  const byId = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const positives = it => it.reviews.filter(r => r.state === 'present').map(r => r.label);
  const totals = {};
  for (const it of byId) for (const l of positives(it)) totals[l] = (totals[l] ?? 0) + 1;
  const chosen = new Set();
  for (const cls of Object.keys(totals).sort((a, b) => totals[a] - totals[b] || a.localeCompare(b))) {
    const want = Math.min(FAST_PER_CLASS, totals[cls]);
    let have = [...chosen].filter(it => positives(it).includes(cls)).length;
    for (const it of byId) {
      if (have >= want) break;
      if (!chosen.has(it) && positives(it).includes(cls)) { chosen.add(it); have++; }
    }
  }
  for (const it of byId) { if (chosen.size >= FAST_SIZE) break; chosen.add(it); }
  items = byId.filter(it => chosen.has(it));
}
mkdirSync(outDir, { recursive: true });
const write = (name, m) => writeFileSync(join(outDir, name), JSON.stringify(m));
write('jamendo.json', { ...jamendo, items });
write('jamendo-strict.json', { ...jamendo, items: items.map(i => ({ ...i, reviews: i.reviews.filter(r => !r.weak) })) });
write('mtgkey.json', mtgkey);
const pos = {};
for (const it of items) for (const r of it.reviews) if (r.state === 'present') pos[r.label] = (pos[r.label] ?? 0) + 1;
console.log(`${mode}: ${items.length} Jamendo tracks (positives ${JSON.stringify(pos)}), ${mtgkey.items.length} MTG key tracks`);
