/* Adds CLAP text vectors for catalog categories that have none yet, without re-encoding any shipped vector.
 * Same prompts generate-sound-prompts.mjs would add (the category description, plus the competing unlabelled
 * prompts for a new axis), each encoded on its own as that script does for non-legacy axes, appended to
 * public/sound-model/prompts.json and scripts/sound-profile-prompts.json; re-pins prompts.json in manifest.json.
 * Needs network access to the Hugging Face model repository at the pinned revision (runs on GitHub Actions).
 * Usage: node scripts/dj-effects/add-prompts.mjs   (prints "nothing to add" and exits when every category has a vector) */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = 'public/sound-model';
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
const prompts = JSON.parse(await readFile(`${root}/prompts.json`, 'utf8'));
const listed = JSON.parse(await readFile('scripts/sound-profile-prompts.json', 'utf8'));
const catalog = JSON.parse(await readFile('src/audio/djCatalog.json', 'utf8'));
const add = [];
const has = (group, label, prompt) => [...prompts, ...add].some(p => p.group === group && (prompt === undefined ? p.label === label : p.prompt === prompt));
for (const c of catalog.categories) if (!has(c.axis, c.label)) add.push({ group: c.axis, label: c.label, prompt: c.description });
const existingAxes = new Set(prompts.map(p => p.group));
const anchors = prompts.filter(p => p.group === 'dj-type' && p.label && p.label !== 'vocal breath');
for (const axis of new Set(catalog.categories.map(c => c.axis))) {
  if (existingAxes.has(axis)) continue;
  const competitors = ['Silence with no identifiable sound.', 'A mixture of unrelated sounds without a clearly identifiable ' + axis.slice(3) + ' sound.',
    ...anchors.filter(p => !catalog.categories.some(c => c.axis === axis && c.label === p.label)).map(p => p.prompt)];
  for (const prompt of competitors) if (!has(axis, null, prompt)) add.push({ group: axis, label: null, prompt });
}
if (!add.length) { console.log('nothing to add'); process.exit(0); }
const { AutoTokenizer, ClapTextModelWithProjection } = await import('@huggingface/transformers');
const options = { revision: manifest.revision, dtype: 'q8', cache_dir: 'artifacts/music-evaluation/clap-cache' };
const tokenizer = await AutoTokenizer.from_pretrained(manifest.repository, options);
const model = await ClapTextModelWithProjection.from_pretrained(manifest.repository, options);
for (const p of add) {
  const { text_embeds } = await model(tokenizer(p.prompt, { padding: true, truncation: true }));
  p.vector = Array.from(text_embeds.data);
  if (p.vector.length !== 512 || !p.vector.every(Number.isFinite)) throw new Error(`bad vector for ${p.prompt}`);
  prompts.push(p); listed.push({ group: p.group, label: p.label, prompt: p.prompt });
  console.log(`+ ${p.group} ${p.label ?? '(competitor)'}: ${p.prompt}`);
}
await model.dispose();
// Append as text: re-serialising would rewrite the number formatting of every shipped vector (same values, noisy diff).
const shipped = await readFile(`${root}/prompts.json`, 'utf8');
if (!shipped.endsWith(']')) throw new Error('prompts.json does not end with ]');
const output = shipped.slice(0, -1) + ',' + add.map(p => JSON.stringify({ group: p.group, label: p.label, prompt: p.prompt, vector: p.vector })).join(',') + ']';
if (JSON.parse(output).length !== prompts.length) throw new Error('prompt count mismatch');
await writeFile(`${root}/prompts.json`, output);
await writeFile('scripts/sound-profile-prompts.json', JSON.stringify(listed, null, 2) + '\n');
manifest.catalogVersion = catalog.version;
manifest.sha256['prompts.json'] = createHash('sha256').update(output).digest('hex');
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`added ${add.length} prompts`);
