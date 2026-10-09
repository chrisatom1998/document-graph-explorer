// Adapt existing DGE listener reviews without promoting guesses/drafts to truth.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [directory, assignmentPath, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node scripts/benchmarks/reviews.mjs <review-directory> <assignments.json> <new-inventory.json>');
if (existsSync(output)) throw new Error('Output already exists');
const root = resolve(directory);
const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const manifest = read('manifest.json'), reviews = read('reviews.json');
const assignments = JSON.parse(readFileSync(assignmentPath, 'utf8'));
if (!Array.isArray(assignments.labels) || !assignments.labels.length || !assignments.clips) throw new Error('Assignments need labels and clip id -> group/split/kind mapping');
const rename = name => name.startsWith('production:') ? `effect:${name.slice(11)}` : name;
const clips = [];
for (const item of manifest.items) {
  const review = reviews[item.id], assignment = assignments.clips[item.id];
  if (!assignment) continue;
  if (review?.confirmed !== true || review?.provenance !== 'explicit human confirmation') {
    throw new Error(`${item.id}: assigned clip does not have explicit human confirmation`);
  }
  if (!Array.isArray(review.knownLabels)) throw new Error(`${item.id}: missing reviewed category snapshot`);
  const known = new Set(review.knownLabels.map(rename));
  const positives = new Set(Object.entries(review.labels).flatMap(([group, labels]) => labels.map(label => rename(`${group}:${label}`))));
  if ([...positives].some(label => !known.has(label))) throw new Error(`${item.id}: positive outside reviewed snapshot`);
  const path = resolve(root, item.preview);
  const truth = Object.fromEntries(assignments.labels.map(label => [label, known.has(label) ? Number(positives.has(label)) : null]));
  clips.push({ id: item.id, path, ...assignment, truth,
    provenance: { type: 'human-reviewed', reference: `DGE review ${item.id}, ${review.reviewedAt}` } });
}
if (!clips.length || clips.length !== Object.keys(assignments.clips).length) throw new Error('Some assigned review IDs were not found; refusing a partial inventory');
writeFileSync(output, JSON.stringify({ labels: assignments.labels, clips }, null, 2) + '\n', { flag: 'wx' });
console.log(`Prepared ${clips.length} human-reviewed clips; unknown categories remain null. Freeze with prepare.mjs next.`);
